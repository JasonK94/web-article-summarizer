import fs from "fs/promises";
import path from "path";
import { load as cheerioLoad } from "cheerio";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import crypto from "crypto";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";
import { logEvent, logApiUsage, setupGlobalErrorHandling } from "./logger.js";

setupGlobalErrorHandling();

const runId = new Date().toISOString().replace(/[:.]/g, '-');
await logEvent({ tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId });

const profiles = JSON.parse(await fs.readFile("config/profiles.json","utf-8"));

const config = {
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  profile: process.env.SUMMARY_PROFILE || "investor"
};

// --- CLI argument parsing ---
function parseArgs(argv) {
  const args = { models: [], profiles: [], provider: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" || a === "--models") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.models.push(argv[++i]); }
    } else if (a === "--profile" || a === "--profiles") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.profiles.push(argv[++i]); }
    } else if (a === "--provider") {
      const v = (argv[i + 1] || ""); if (v && !v.startsWith("--")) { args.provider = v.toLowerCase(); i++; }
    }
  }
  return args;
}

const cli = parseArgs(process.argv);
if (cli.provider) config.provider = cli.provider;
let modelsToRun = cli.models.length ? cli.models : [config.provider === 'openai' ? "gpt-4o-mini" : config.geminiModel];
let profilesToRun = cli.profiles.length ? cli.profiles : [config.profile];


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genai = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const outDir = path.resolve("output");
await fs.mkdir(outDir, { recursive: true });

async function main() {
  const sourcesPath = path.resolve("input", "sources.csv");
  let sources = [];
  try {
    const csvRaw = await fs.readFile(sourcesPath, "utf-8");
    sources = csvParse(csvRaw, { columns: true, skip_empty_lines: true });
  } catch (e) {
    console.error(`Could not read input/sources.csv: ${e.message}`);
    process.exit(1);
  }

  const profileCfg = profiles.profiles[config.profile];
  if (!profileCfg) { console.error("Invalid SUMMARY_PROFILE"); process.exit(1); }

  // --- Helpers copied from app.js for consistency ---
  const allSectionNames = Array.from(new Set(Object.values(profiles.profiles).flatMap(p => p.format?.sections || [])));
  function computeProfileConfigHash(profileKey) {
    const p = profiles.profiles[profileKey] || {};
    return crypto.createHash("md5").update(JSON.stringify(p)).digest("hex");
  }
  function computeTaskKey(sourceId, modelKey, profileKey) {
    const hash = computeProfileConfigHash(profileKey);
    return crypto.createHash("md5").update(`manual|${sourceId}|${config.provider}|${modelKey}|${profileKey}|${hash}`).digest("hex");
  }
  function parseSections(summaryText, expectedSections) {
    if (!summaryText) return {};
    const lines = summaryText.split(/\r?\n/);
    const sections = {};
    let current = null;
    const normalizedHeaders = new Set(expectedSections.map(s => s.toLowerCase()));
    for (const line of lines) {
      const trimmed = line.trim().replace(/^#+\s*/, "");
      if (!trimmed) continue;
      if (normalizedHeaders.has(trimmed.toLowerCase())) {
        current = trimmed;
        if (!sections[current]) sections[current] = [];
        continue;
      }
      if (current) sections[current].push(line);
    }
    for (const key of Object.keys(sections)) {
      sections[key] = sections[key].join("\n").trim();
    }
    return sections;
  }


  function extractFromHtml(html) {
    const $ = cheerioLoad(html);
    const title = $('h1').first().text().trim() || $('title').text().trim();
    const candidates = ['article','[data-testid="article-body"]','.article-body','.story-body','main','.content','.article-content'];
    let text = '';
    for (const sel of candidates){
      const el = $(sel);
      if (el.length){ text = el.text().trim(); if (text.length>400) break; }
    }
    if (!text) text = $('body').text().trim();
    return { title, text };
  }

  async function translateText(text, targetLang = "Korean") {
    if (!text) return "";
    try {
      const modelKey = "gemini-2.5-flash";
      const model = genai.getGenerativeModel({ model: modelKey });
      const prompt = `Translate the following English text to ${targetLang}. Only return the translated text.\n\n${text}`;
      const result = await model.generateContent(prompt);
      const translatedText = result.response.text();
      const tokensUsed = Math.round((prompt.length + translatedText.length) / 4);
      const cost = tokensUsed * (profiles.models[modelKey]?.cost_per_1k_tokens || 0) / 1000;
      await logApiUsage({ provider: "gemini", model: modelKey, tokensUsed, cost, function: "translate" });
      return translatedText;
    } catch (e) {
      return `Translation failed: ${e.message}`;
    }
  }

  async function summarize(provider, model, profileCfg, url, title, text){
    let summary = "";
    let tokensUsed = 0;
    const systemPrompt = profileCfg.system_prompt;
    const userPrompt = `Please summarize the following article:\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}`;

    if (provider === 'openai') {
      const resp = await openai.chat.completions.create({
        model,
        messages: [
          {role:'system',content:systemPrompt},
          {role:'user',content:userPrompt}
        ],
        temperature: profileCfg.temperature,
        // max_tokens: profileCfg.max_tokens // Deprecated for some models
      });
      summary = resp.choices[0].message.content;
      tokensUsed = resp.usage.total_tokens;
    } else if (provider === 'gemini') {
      const gmodel = genai.getGenerativeModel({ model });
      const result = await gmodel.generateContent(`System: ${systemPrompt}\n\nUser: ${userPrompt}`);
      summary = result.response.text();
      tokensUsed = Math.round((systemPrompt.length + userPrompt.length + summary.length) / 4);
    }
    
    const cost = tokensUsed * (profiles.models[model]?.cost_per_1k_tokens || 0) / 1000;
    await logApiUsage({ provider, model, tokensUsed, cost, function: "summarize" });

    return summary;
  }

  const allSummaries = [];
  for (const modelKey of modelsToRun) {
    for (const profileKey of profilesToRun) {
      const activeProfile = profiles.profiles[profileKey];
      if (!activeProfile) {
        console.log(`✗ Profile ${profileKey} not found, skipping.`);
        continue;
      }

      console.log(`\n▶ Running provider=${config.provider} model=${modelKey} profile=${profileKey}`);
      for (const r of sources){
        try {
          let title = r.title;
          let text = r.content;
          if (r.type === 'html'){
            const ex = extractFromHtml(r.content);
            title = title || ex.title;
            text = ex.text;
          }
          
          const sum = await summarize(config.provider, modelKey, activeProfile, r.url, title, text);
          const koreanSummary = await translateText(sum);
          
          // --- Data processing for all_runs.csv ---
          const sectionsMap = parseSections(sum, allSectionNames);
          const taskKey = computeTaskKey(r.id, modelKey, profileKey);
          const summaryData = {
            title: title,
            url: r.url,
            processed: new Date().toISOString(),
            summary: sum,
            koreanSummary: koreanSummary,
            contentLength: text.length,
            tokensUsed: 0, // Token count is not available for manual input
            profile: profileKey,
            model: modelKey,
            provider: config.provider,
            source: r.url ? new URL(r.url).hostname.replace(/^www\./,'') : 'manual',
            sections: sectionsMap,
            cost: 0,
            key: taskKey,
            articleId: r.id,
            profileConfigHash: computeProfileConfigHash(profileKey)
          };
          allSummaries.push(summaryData);

          // Sanitize filename from title/url; fallback to id
          const baseName = (title || r.title || r.url || r.id || 'source').replace(/[^\w\-]+/g,'_').slice(0,120);
          const fname = `${baseName}_${r.id}_${modelKey}_${profileKey}.manual.md`;
          await fs.writeFile(path.join(outDir,fname), `# ${title}\n\n**URL:** ${r.url}\n\n## English Summary\n${sum}\n\n## Korean Summary\n${koreanSummary}`, 'utf-8');
          console.log(`✓ summarized ${r.id||r.url} -> ${fname}`);
        } catch(e){
          console.log(`✗ summarize error ${r.id||r.url} with model ${modelKey}: ${e.message}`);
        }
      }
    }
  }

  await logEvent({ tag: "run:end", script: process.argv[1], runId, filesCreated: allSummaries.length });

  // --- Append to all_runs.csv ---
  if (allSummaries.length > 0) {
    const aggregatorPath = path.join(outDir, "all_runs.csv");
    
    // Always recreate the CSV to ensure proper UTF-8 BOM for Korean characters in Excel.
    try {
      await fs.unlink(aggregatorPath);
    } catch (error) {
      if (error.code !== 'ENOENT') { // Ignore if file doesn't exist
        console.error(`Error removing existing all_runs.csv: ${error.message}`);
      }
    }

    const headerCols = [
      "No","Timestamp","Source","URL","Title","Content Length","Tokens Used","Provider","Profile","Model","Cost","Summary","Korean Summary","Key","ArticleId","ProfileConfigHash",
      ...allSectionNames
    ];
    const buildCsvRow = (row) => row.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",");
    
    const rowsToAppend = allSummaries.map((s, idx) => buildCsvRow([
      idx + 1, s.processed, s.source, s.url, s.title, s.contentLength, s.tokensUsed, s.provider, s.profile, s.model, s.cost.toFixed(6), s.summary, s.koreanSummary, s.key, s.articleId, s.profileConfigHash,
      ...allSectionNames.map(name => s.sections?.[name] || "")
    ]));
    
    const headerRow = headerCols.join(",");
    const csvContent = rowsToAppend.join("\n") + "\n";

    await fs.writeFile(aggregatorPath, "\ufeff" + headerRow + "\n" + csvContent, "utf-8");
    
    console.log(`\n📊 Wrote ${allSummaries.length} summaries to ${aggregatorPath}`);
  }

  console.log('Done sources-run.');
  process.exit(0);
}

main();


