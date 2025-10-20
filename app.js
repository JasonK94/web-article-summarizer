import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";
import "dotenv/config";
import { logEvent, logServer, makeRateCounter, logApiUsage } from "./logger.js";

const runId = new Date().toISOString().replace(/[:.]/g, '-');
await logEvent({ tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId });

// Load configuration
const profiles = JSON.parse(await fs.readFile("config/profiles.json", "utf-8"));

// Configuration
const config = {
  chromeUserData: process.env.CHROME_USER_DATA || "C:/Users/USER/AppData/Local/Google/Chrome/User Data",
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  summaryProfile: process.env.SUMMARY_PROFILE || "investor",
  timeout: 120000,
  outputFormat: process.env.OUTPUT_FORMAT || "markdown",
  useTempProfile: process.env.USE_TEMP_PROFILE === "true"
};

// Validate configuration
if (!profiles.profiles[config.summaryProfile]) {
  console.error(`❌ Invalid profile: ${config.summaryProfile}`);
  console.log("Available profiles:", Object.keys(profiles.profiles).join(", "));
  process.exit(1);
}

const profile = profiles.profiles[config.summaryProfile];
console.log("🚀 Web Article Summarizer Tool");
console.log(`📋 Default Profile: ${profile.name} - ${profile.description}`);
console.log(`🤖 Provider: ${config.provider}  (model via --model or env)\n`);

// --- CLI argument parsing ---
function parseArgs(argv) {
  const args = { models: [], profiles: [], articles: [], duplicate: false, provider: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" || a === "--models") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.models.push(argv[++i]); }
    } else if (a === "--profile" || a === "--profiles") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.profiles.push(argv[++i]); }
    } else if (a === "--article" || a === "--articles") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.articles.push(argv[++i]); }
    } else if (a === "--duplicate") {
      const v = (argv[i + 1] || "false").toLowerCase();
      if (!v.startsWith("--")) i++;
      args.duplicate = ["true","1","yes","y"].includes(v);
    } else if (a === "--provider") {
      const v = (argv[i + 1] || ""); if (v && !v.startsWith("--")) { args.provider = v.toLowerCase(); i++; }
    }
  }
  return args;
}

const cli = parseArgs(process.argv);
if (cli.provider) config.provider = cli.provider;

// Load URLs from file (supports urls.csv with id,url or urls.txt)
async function loadUrls() {
  const urls = [];
  try {
    const csv = await fs.readFile("urls.csv", "utf-8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase();
    if (header.includes("url")) {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/,(.+)/); // id,url (url can contain commas)
        const id = parts[0]?.trim();
        const url = (parts[1] || "").trim();
        if (url) urls.push({ id, url });
      }
      return urls;
    }
  } catch {}
  // Fallback to urls.txt
  const txt = (await fs.readFile("urls.txt", "utf-8")).split("\n").map(s => s.trim()).filter(Boolean);
  return txt.map((u, idx) => ({ id: String(idx + 1), url: u }));
}

const urlItems = await loadUrls();
// If models/profiles set to all, default to a single article when --article not provided
const wantAllModels = cli.models.includes("all");
const wantAllProfiles = cli.profiles.includes("all");
let selectedArticles = cli.articles.length ? cli.articles.map(s => String(s)) : [];
if (!selectedArticles.length && (wantAllModels || wantAllProfiles)) {
  selectedArticles = [urlItems[0]?.id].filter(Boolean);
}
if (!selectedArticles.length) {
  selectedArticles = urlItems.map(u => u.id);
}

// Prepare model/profile lists
const allModelKeys = Object.keys(profiles.models);
let modelsToRun = cli.models.length ? (wantAllModels ? allModelKeys : cli.models) : [config.openaiModel];
// Normalize to known keys if possible
modelsToRun = modelsToRun.map(m => m in profiles.models ? m : m);

const allProfileKeys = Object.keys(profiles.profiles);
let profilesToRun = cli.profiles.length ? (wantAllProfiles ? allProfileKeys : cli.profiles) : [config.summaryProfile];

// De-duplicate URL list by URL
const seenUrl = new Set();
const urls = urlItems.filter(u => {
  if (!selectedArticles.includes(u.id)) return false;
  if (seenUrl.has(u.url)) return false;
  seenUrl.add(u.url);
  return true;
});

// Unified output directory (no per-model subfolders) for easier comparisons
const outDir = path.resolve("output");
await fs.mkdir(outDir, { recursive: true });

// Optional: prefer archived pages to avoid live requests
async function findArchivedHtml(targetUrl) {
  try {
    const idxPath = path.resolve("archive", "archive_index.csv");
    const csv = await fs.readFile(idxPath, "utf-8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines.shift();
    let best = null;
    for (const line of lines) {
      // id,timestamp,source,url,type,path
      const parts = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
      const urlCol = (parts[3] || "").replace(/^\"|\"$/g, "");
      if (urlCol === targetUrl) {
        const ts = (parts[1] || "").replace(/^\"|\"$/g, "");
        const p = (parts[5] || "").replace(/^\"|\"$/g, "");
        if (!best || ts > best.ts) best = { ts, path: path.resolve(p) };
      }
    }
    return best?.path || null;
  } catch {
    return null;
  }
}

// Initialize clients per provider
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genai = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Launch browser
let browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

if (config.useTempProfile) {
  console.log("🔒 Using temporary Chrome profile (paywalls may block)");
} else {
  browserArgs.push(`--user-data-dir=${config.chromeUserData}`);
  browserArgs.push(`--profile-directory=${config.chromeProfile}`);
  console.log("🔑 Using your Chrome profile for paywall access");
}

puppeteerExtra.use(StealthPlugin());
const launchPptr = (process.env.ATTACH_TO_DEBUGGER === "true" ? null : (config.useTempProfile ? puppeteer : puppeteerExtra));
let browser;
if (process.env.ATTACH_TO_DEBUGGER === "true") {
  // Attach to already running Chrome started with --remote-debugging-port=9222
  browser = await puppeteer.connect({ browserURL: process.env.DEBUGGER_URL || "http://localhost:9222" });
} else {
  browser = await launchPptr.launch({
  headless: true,
  args: browserArgs
  });
}

console.log(`\n📊 Processing ${urls.length} URLs...\n`);
await logEvent({ tag: "summarize:start", provider: config.provider, models: modelsToRun, profiles: profilesToRun, urls: urls.length });
const bump = makeRateCounter();

// Array to store all summaries for CSV output
const allSummaries = [];
let totalTokens = 0;

// Build a unified list of all possible section names across profiles for CSV columns
const allSectionNames = Array.from(
  new Set(
    Object.values(profiles.profiles)
      .flatMap(p => p.format?.sections || [])
  )
);

function extractSourceFromUrl(articleUrl) {
  try {
    const u = new URL(articleUrl);
    const host = u.hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "unknown";
  }
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
    // If line matches any expected section header (case-insensitive), switch context
    if (normalizedHeaders.has(trimmed.toLowerCase())) {
      current = trimmed;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (current) {
      sections[current].push(line);
    }
  }
  // Join arrays into strings
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].join("\n").trim();
  }
  return sections;
}

async function translateText(text, targetLang = "Korean") {
  if (!text) return "";
  try {
    const modelKey = "gemini-2.5-flash"; // Hardcode cost-effective model for translation
    const model = genai.getGenerativeModel({ model: modelKey });
    const prompt = `Translate the following English text to ${targetLang}. Only return the translated text, without any preamble or explanation.\n\nENGLISH TEXT:\n---\n${text}`;
    const result = await model.generateContent(prompt);
    
    // Mock token usage for logging, as Gemini API v1 doesn't provide it directly.
    // This is a rough estimate.
    const tokensUsed = Math.round((prompt.length + result.response.text().length) / 4);
    const cost = tokensUsed * (profiles.models[modelKey]?.cost_per_1k_tokens || 0) / 1000;
    await logApiUsage({ provider: "gemini", model: modelKey, tokensUsed, cost, function: "translate" });

    return result.response.text();
  } catch (e) {
    logEvent({ tag: "translate:error", message: e.message });
    return `Translation failed: ${e.message}`;
  }
}

// Load existing keys from aggregator to support duplicate skip
const aggregatorPath = path.resolve("output", "all_runs.csv");
const existingKeys = new Set();
try {
  const existing = await fs.readFile(aggregatorPath, "utf-8");
  const lines = existing.split(/\r?\n/).filter(Boolean);
  const header = lines.shift() || "";
  const cols = header.split(",");
  const keyIdx = cols.findIndex(c => c.replace(/\"/g, "").toLowerCase() === "key");
  for (const line of lines) {
    const parts = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/); // split commas not inside quotes
    const key = parts[keyIdx] ? parts[keyIdx].replace(/^\"|\"$/g, "") : "";
    if (key) existingKeys.add(key);
  }
} catch {}

function computeProfileConfigHash(profileKey) {
  const p = profiles.profiles[profileKey] || {};
  const str = JSON.stringify(p);
  return crypto.createHash("md5").update(str).digest("hex");
}

function computeTaskKey(articleUrl, modelKey, profileKey) {
  const hash = computeProfileConfigHash(profileKey);
  return crypto.createHash("md5").update(`${articleUrl}|${config.provider}|${modelKey}|${profileKey}|${hash}`).digest("hex");
}

// Iterate over model/profile combinations and URLs
for (const modelKey of modelsToRun) {
  // Map model key to provider-specific model
  if (config.provider === "openai") config.openaiModel = modelKey;
  if (config.provider === "gemini") config.geminiModel = modelKey;
  const profileKey = null; // placeholder to satisfy linter
  for (const profKey of profilesToRun) {
    // Update selected profile
    const activeProfile = profiles.profiles[profKey];
    if (!activeProfile) continue;
    const profileConfigHash = computeProfileConfigHash(profKey);

    console.log(`\n▶ Running provider=${config.provider} model=${modelKey} profile=${profKey}`);
    for (let i = 0; i < urls.length; i++) {
      const { id: articleId, url } = urls[i];
      const progress = `[${i + 1}/${urls.length}]`;
      const taskKey = computeTaskKey(url, modelKey, profKey);
      if (!cli.duplicate && existingKeys.has(taskKey)) {
        console.log(`${progress} ⏭️  Skipping existing summary (key=${taskKey.slice(0,8)}...)`);
        continue;
      }
  
  console.log(`${progress} 🔍 Processing: ${url}`);
  
  try {
  const page = await browser.newPage();
    // Human-like behavior: small jitter, scroll, and mouse moves
    await page.waitForTimeout(500 + Math.floor(Math.random()*800));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    // Optional cookie injection
    if (process.env.COOKIES_PATH) {
      try {
        const cookiesRaw = await fs.readFile(process.env.COOKIES_PATH, 'utf-8');
        const cookies = JSON.parse(cookiesRaw);
        await page.setCookie(...cookies);
      } catch(e) {
        await logEvent({ tag: 'cookie:load_error', message: e.message });
      }
    }
    // Prefer archived HTML if available
    const archivedHtmlPath = await findArchivedHtml(url);
    if (archivedHtmlPath) {
      const fileUrl = 'file:///' + archivedHtmlPath.replace(/\\/g,'/');
      const host = extractSourceFromUrl(url);
      const startTs = Date.now();
      await page.goto(fileUrl, { waitUntil: "domcontentloaded", timeout: config.timeout });
      const counts = bump(host);
      await logServer({ tag: "summarize:goto_archived", host, url, dur_ms: Date.now()-startTs, counts });
    } else {
      // Navigate live (last resort)
      const host = extractSourceFromUrl(url);
      const startTs = Date.now();
      await page.goto(url, { waitUntil: "networkidle2", timeout: config.timeout });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const counts = bump(host);
      await logServer({ tag: "summarize:goto_live", host, url, dur_ms: Date.now()-startTs, counts });
    }
    
    // Extract article content
    const articleData = await page.evaluate(() => {
      const selectors = [
        'article',
        '[data-testid="article-body"]',
        '.article-body',
        '.story-body',
        'main',
        '.content',
        '.article-content'
      ];
      
      let content = '';
      let title = '';
      
      // Find title
      const titleSelectors = ['h1', '.headline', '.article-title', 'title'];
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl && titleEl.textContent.trim()) {
          title = titleEl.textContent.trim();
          break;
        }
      }
      
      // Find content
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          content = element.textContent.trim();
          if (content.length > 500) break;
        }
      }
      
      if (!content || content.length < 500) {
        content = document.body.textContent.trim();
      }
      
      return { title, content };
    });
    
    if (!articleData.content || articleData.content.length < 100) {
      console.log(`${progress} ⚠️  Warning: Limited content extracted`);
    }
    
    // Clean up the content
    const cleanContent = articleData.content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    console.log(`${progress} 📄 Extracted ${cleanContent.length} characters`);
    
    // Generate summary using selected provider
    let summary = "";
    let tokensUsed = 0;
    if (config.provider === "openai") {
      const summaryResponse = await openai.chat.completions.create({
        model: modelKey,
        messages: [{ role: "system", content: activeProfile.system_prompt }, { role: "user", content: `Please analyze this article using the ${activeProfile.name} format:\n\nTitle: ${articleData.title}\nURL: ${url}\n\nContent:\n${cleanContent}\n\nPlease structure your response according to these sections:\n${activeProfile.format.sections.map(s => `- ${s}`).join('\n')}` }],
        temperature: 0.5,
        max_tokens: 2000
      });
      summary = summaryResponse.choices[0].message.content;
      tokensUsed = summaryResponse.usage.total_tokens;
    } else if (config.provider === "gemini") {
      if (!genai) throw new Error("GEMINI_API_KEY not set");
      const gmodel = genai.getGenerativeModel({ model: modelKey });
      const prompt = `System: ${activeProfile.system_prompt}\n\nUser: Please analyze this article using the ${activeProfile.name} format.\n\nTitle: ${articleData.title}\nURL: ${url}\n\nContent:\n${cleanContent}\n\nPlease structure your response according to these sections:\n${activeProfile.format.sections.map(s => `- ${s}`).join('\n')}`;
      const result = await gmodel.generateContent(prompt);
      summary = result.response.text();
      // Gemini API v1 doesn't return token count, so we estimate
      tokensUsed = Math.round((activeProfile.system_prompt.length + prompt.length + summary.length) / 4);
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }
    totalTokens += tokensUsed;
    
    const cost = tokensUsed * (profiles.models[modelKey]?.cost_per_1k_tokens || 0) / 1000;
    await logApiUsage({ provider: config.provider, model: modelKey, tokensUsed, cost, function: "summarize" });

    console.log(`${progress} ✅ Generated summary (${tokensUsed} tokens)`);
    await logEvent({ tag: "summarize:generated", key: taskKey, tokensUsed, provider: config.provider, model: modelKey, profile: profKey });
    
    // Parse per-section content for structured comparison
    const sectionsMap = parseSections(summary, allSectionNames);
    const koreanSummary = await translateText(summary);

    // Store summary data
    const summaryData = {
      title: articleData.title,
      url: url,
      processed: new Date().toISOString(),
      summary: summary,
      contentLength: cleanContent.length,
      tokensUsed: tokensUsed,
      profile: profKey,
      model: modelKey,
      provider: config.provider,
      source: extractSourceFromUrl(url),
      sections: sectionsMap,
      cost: cost,
      key: taskKey,
      articleId,
      profileConfigHash,
      koreanSummary
    };
    
    allSummaries.push(summaryData);
    
    // Save individual summary files in multiple formats
    const safeUrl = url.replace(/[^\w\-]+/g, "_").slice(0, 100);
    
    // Save as Markdown
    const summaryPath = path.join(outDir, `${safeUrl}.md`);
    const summaryContent = `# ${articleData.title}

**URL:** ${url}  
**Processed:** ${new Date().toISOString()}  
**Profile:** ${activeProfile.name}  
**Model:** ${profiles.models[modelKey]?.name || modelKey}  
**Tokens Used:** ${tokensUsed}

## Summary

${summary}

---
*Generated by Web Article Summarizer Tool*`;
    await fs.writeFile(summaryPath, summaryContent, "utf-8");
    filesCreated++;
    
    // Save as JSON for structured comparison
    const jsonPath = path.join(outDir, `${safeUrl}.json`);
    const jsonContent = {
      metadata: {
        title: articleData.title,
        url: url,
        processed: summaryData.processed,
        profile: profKey,
        model: modelKey,
        tokensUsed: tokensUsed,
        contentLength: cleanContent.length,
        cost: cost
      },
      summary: summary,
      rawContent: cleanContent.substring(0, 1000) // First 1000 chars for reference
    };
    await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2), "utf-8");
    filesCreated++;
    
    // Save as CSV for spreadsheet analysis (row-level file)
    const csvPath = path.join(outDir, `${safeUrl}.${modelKey}.csv`);
    const headerCols = [
      "No","Timestamp","Source","URL","Title","Content Length","Tokens Used","Provider","Profile","Model","Cost","Summary","Korean Summary","Key","ArticleId","ProfileConfigHash",
      ...allSectionNames
    ];
    // Build a single-row CSV with proper quoting
    const buildCsvRow = (row) => row.map(v => {
      const s = (v ?? "").toString();
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",");
    const rowValues = [
      1,
      summaryData.processed,
      summaryData.source,
      url,
      articleData.title,
      cleanContent.length,
      tokensUsed,
      config.provider,
      profKey,
      modelKey,
      cost.toFixed(6),
      summary,
      koreanSummary,
      taskKey,
      articleId,
      profileConfigHash,
      ...allSectionNames.map(name => summaryData.sections[name] || "")
    ];
    const singleCsv = headerCols.join(",") + "\n" + buildCsvRow(rowValues) + "\n";
    await fs.writeFile(csvPath, singleCsv, "utf-8");
    filesCreated++;
    
    await page.close();
    
  } catch (error) {
    console.error(`${progress} ❌ Error:`, error.message);
    
    const errorPath = path.join(outDir, `error_${Date.now()}.txt`);
    await fs.writeFile(errorPath, `URL: ${url}\nError: ${error.message}\nTime: ${new Date().toISOString()}`, "utf-8");
  }
    }
    // end per-URL loop
  }
  // end per-profile loop
}
// end per-model loop

// Save consolidated output in multiple formats
if (allSummaries.length > 0) {
  // Unified aggregator CSV across runs: output/all_runs.csv
  const aggregatorPath = path.join(outDir, "all_runs.csv");
  const headerCols = [
    "No","Timestamp","Source","URL","Title","Content Length","Tokens Used","Provider","Profile","Model","Cost","Summary","Korean Summary","Key","ArticleId","ProfileConfigHash",
    ...allSectionNames
  ];
  const buildCsvRow = (row) => row.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",");
  let existingContent = "";
  let existingLines = 0;
  try {
    existingContent = await fs.readFile(aggregatorPath, "utf-8");
    existingLines = Math.max(0, existingContent.split(/\r?\n/).filter(Boolean).length - 1);
  } catch {}

  const rowsToAppend = allSummaries.map((s, idx) => buildCsvRow([
    existingLines + idx + 1,
    s.processed,
    s.source,
    s.url,
    s.title,
    s.contentLength,
    s.tokensUsed,
    s.provider,
    s.profile,
    s.model,
    (s.cost ?? (s.tokensUsed * (profiles.models[s.model]?.cost_per_1k_tokens || 0) / 1000)).toFixed(6),
    s.summary,
    s.koreanSummary,
    s.key,
    s.articleId,
    s.profileConfigHash,
    ...allSectionNames.map(name => s.sections?.[name] || "")
  ]));
  
  const headerRow = headerCols.join(",");
  const csvContent = rowsToAppend.join("\n") + "\n";
  
  if (existingLines === 0) {
    await fs.writeFile(aggregatorPath, "\ufeff" + headerRow + "\n" + csvContent, "utf-8");
  } else {
    await fs.appendFile(aggregatorPath, csvContent, "utf-8");
  }
  
  console.log(`\n📊 Unified CSV updated: ${aggregatorPath}`);
  await logEvent({ tag: "summarize:all_runs_updated", rows: allSummaries.length });
  
  // Save consolidated JSON for programmatic analysis
  const jsonData = {
    metadata: {
      generated: new Date().toISOString(),
      profile: profile.name,
      model: model.name,
      totalUrls: allSummaries.length,
      totalTokens: totalTokens,
      totalCost: totalTokens * model.cost_per_1k_tokens / 1000
    },
    summaries: allSummaries.map(s => ({
      title: s.title,
      url: s.url,
      processed: s.processed,
      summary: s.summary,
      contentLength: s.contentLength,
      tokensUsed: s.tokensUsed,
      cost: s.tokensUsed * model.cost_per_1k_tokens / 1000,
      source: s.source,
      profile: s.profile,
      model: s.model,
      sections: s.sections
    }))
  };
  
  const jsonPath = path.join(outDir, "last_run.json");
  await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(`📋 Last run JSON saved: ${jsonPath}`);
  
  // Save summary report
  const reportPath = path.join(outDir, "summary_report.md");
  const reportContent = `# Summary Report

**Generated:** ${new Date().toISOString()}  
**Profile:** ${profile.name}  
**Model:** ${model.name}  
**Total URLs Processed:** ${allSummaries.length}  
**Total Tokens Used:** ${totalTokens}  
**Estimated Cost:** $${(totalTokens * model.cost_per_1k_tokens / 1000).toFixed(4)}

## Processed Articles

${allSummaries.map((s, i) => `${i + 1}. [${s.title}](${s.url}) - ${s.tokensUsed} tokens - $${(s.tokensUsed * model.cost_per_1k_tokens / 1000).toFixed(4)}`).join('\n')}

## Model Performance Analysis

- **Average tokens per article:** ${Math.round(totalTokens / allSummaries.length)}
- **Cost per article:** $${(totalTokens * model.cost_per_1k_tokens / 1000 / allSummaries.length).toFixed(4)}
- **Model efficiency:** ${model.name} (${model.description})

---
*Generated by Web Article Summarizer Tool*`;
  
  await fs.writeFile(reportPath, reportContent, "utf-8");
  console.log(`📋 Summary report saved: ${reportPath}`);
}

await browser.close();
await logEvent({ tag: "summarize:end", runId, filesCreated });

console.log(`\n🎉 Processing complete!`);
console.log(`📁 Output saved to: ${outDir}`);
console.log(`💰 Total cost: $${(totalTokens * model.cost_per_1k_tokens / 1000).toFixed(4)}`);
console.log(`📊 Processed ${allSummaries.length} articles successfully`);

// Explicit exit to prevent hanging
process.exit(0);