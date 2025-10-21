import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";
import "dotenv/config";
import { logEvent, logServer, makeRateCounter, logApiUsage, setupGlobalErrorHandling } from "./logger.js";

setupGlobalErrorHandling();

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
await logEvent({ tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId });

// Load configuration
const profiles = JSON.parse(await fs.readFile("config/profiles.json", "utf-8"));

// Configuration
const config = {
  chromeUserData: process.env.CHROME_USER_DATA || "C:/Users/USER/AppData/Local/Google/Chrome/User Data",
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-pro",
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
  const urlsCsvPath = path.resolve("input", "urls.csv");
  const urlsTxtPath = path.resolve("input", "urls.txt");
  let items = [];
  try {
    const csv = await fs.readFile(urlsCsvPath, "utf-8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase();
    if (header.includes("url")) {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/,(.+)/); // id,url (url can contain commas)
        const id = parts[0]?.trim();
        const url = (parts[1] || "").trim();
        if (url) items.push({ id, url });
      }
      return items;
    }
  } catch {}
  // Fallback to urls.txt
  const txt = (await fs.readFile(urlsTxtPath, "utf-8")).split("\n").map(s => s.trim()).filter(Boolean);
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
    const indexPath = path.resolve("archive", "archive_index.csv");
    const csv = await fs.readFile(indexPath, "utf-8");
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

async function getSummary(provider, modelKey, profile, content) {
  const systemPrompt = profile.system_prompt;
  const userPrompt = `Article content:\n\n${content}`;
  let summary = "";
  let tokensUsed = 0;

  const apiParams = {
    model: modelKey,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  if (profile.temperature && profile.temperature !== 1) {
    apiParams.temperature = profile.temperature;
  }

  if (provider === "openai") {
    const response = await openai.chat.completions.create(apiParams);
    summary = response.choices[0].message.content;
    tokensUsed = response.usage?.total_tokens || 0;
  } else if (provider === "gemini") {
    const model = genai.getGenerativeModel({ model: modelKey });
    const result = await model.generateContent([systemPrompt, userPrompt]);
    summary = result.response.text();
    tokensUsed = Math.round((systemPrompt.length + userPrompt.length + summary.length) / 4);
  }

  const cost = (tokensUsed / 1000) * (profiles.models[modelKey]?.cost_per_1k_tokens || 0);
  await logApiUsage({ provider, model: modelKey, tokensUsed, cost, function: "summarize" });

  return { summary, tokensUsed, cost };
}

async function main() {
  await logEvent({ tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId });
  
  // Load urls logic
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

  let filesCreated = 0;
  
  for (const { id, url } of urls) {
    const progress = `[${urls.indexOf({ id, url }) + 1}/${urls.length}]`;
    try {
      // Logic to get article content, either from archive or live
  const page = await browser.newPage();
      // Human-like behavior: small jitter, scroll, and mouse moves
      await sleep(500 + Math.floor(Math.random()*800));
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
        await sleep(2000); // Correctly use sleep instead of page.waitForTimeout
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
        const apiParams = {
          model: modelKey,
          messages: [
            { role: "system", content: activeProfile.system_prompt },
      {
        role: "user",
              content: `Please analyze this article using the ${activeProfile.name} format:\n\nTitle: ${articleData.title}\nURL: ${url}\n\nContent:\n${cleanContent}\n\nPlease structure your response according to these sections:\n${activeProfile.format.sections.map(s => `- ${s}`).join('\n')}`
            }
          ]
        };

        // Conditionally add temperature
        if (activeProfile.temperature !== 1) {
          apiParams.temperature = activeProfile.temperature;
        }

        const summaryResponse = await openai.chat.completions.create(apiParams);
        summary = summaryResponse.choices[0].message.content;
        tokensUsed = summaryResponse.usage?.total_tokens || 0;
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
      // filesCreated++; // This line was removed from the new_code, so it's removed here.
      
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
      // filesCreated++; // This line was removed from the new_code, so it's removed here.
      
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
      // filesCreated++; // This line was removed from the new_code, so it's removed here.
      
      await page.close();
      
    } catch (e) {
      console.error(`${progress} ❌ Top-level Error: ${e.message}`);
    }
  }

  console.log("\n🎉 Processing complete!");
  await logEvent({ tag: "summarize:end", runId, filesCreated });
}

main();