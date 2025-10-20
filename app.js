import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// Load configuration
const profiles = JSON.parse(await fs.readFile("config/profiles.json", "utf-8"));

// Configuration
const config = {
  chromeUserData: process.env.CHROME_USER_DATA || "C:/Users/USER/AppData/Local/Google/Chrome/User Data",
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-pro",
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
const model = profiles.models[config.openaiModel] || profiles.models["gpt-4o-mini"];

console.log("🚀 Web Article Summarizer Tool");
console.log(`📋 Profile: ${profile.name} - ${profile.description}`);
console.log(`🤖 Model: ${model.name} - ${model.description}`);
console.log(`💰 Estimated cost: $${model.cost_per_1k_tokens}/1k tokens\n`);

// Load URLs from file
const urls = (await fs.readFile("urls.txt", "utf-8"))
  .split("\n").map(s => s.trim()).filter(Boolean);

// Unified output directory (no per-model subfolders) for easier comparisons
const outDir = path.resolve("output");
await fs.mkdir(outDir, { recursive: true });

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

const browser = await puppeteer.launch({
  headless: true,
  args: browserArgs
});

console.log(`\n📊 Processing ${urls.length} URLs...\n`);

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

// Process each URL
for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  const progress = `[${i + 1}/${urls.length}]`;
  
  console.log(`${progress} 🔍 Processing: ${url}`);
  
  try {
    const page = await browser.newPage();
    
    // Navigate to the page
    await page.goto(url, { waitUntil: "networkidle2", timeout: config.timeout });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
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
        model: config.openaiModel,
        messages: [
          {
            role: "system",
            content: profile.system_prompt
          },
      {
        role: "user",
            content: `Please analyze this article using the ${profile.name} format:

Title: ${articleData.title}
URL: ${url}

Content:
${cleanContent}

Please structure your response according to these sections:
${profile.format.sections.map(s => `- ${s}`).join('\n')}`
          }
        ],
        max_tokens: profile.max_tokens,
        temperature: profile.temperature
      });
      summary = summaryResponse.choices[0].message.content;
      tokensUsed = summaryResponse.usage?.total_tokens || 0;
    } else if (config.provider === "gemini") {
      if (!genai) throw new Error("GEMINI_API_KEY not set");
      const model = genai.getGenerativeModel({ model: config.geminiModel });
      const prompt = `System: ${profile.system_prompt}\n\nUser: Please analyze this article using the ${profile.name} format.\n\nTitle: ${articleData.title}\nURL: ${url}\n\nContent:\n${cleanContent}\n\nPlease structure your response according to these sections:\n${profile.format.sections.map(s => `- ${s}`).join('\n')}`;
      const resp = await model.generateContent(prompt);
      summary = resp.response.text();
      tokensUsed = 0; // Gemini token usage not available from this SDK in detail
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }
    totalTokens += tokensUsed;
    
    console.log(`${progress} ✅ Generated summary (${tokensUsed} tokens)`);
    
    // Parse per-section content for structured comparison
    const sectionsMap = parseSections(summary, allSectionNames);

    // Store summary data
    const summaryData = {
      title: articleData.title,
      url: url,
      processed: new Date().toISOString(),
      summary: summary,
      contentLength: cleanContent.length,
      tokensUsed: tokensUsed,
      profile: config.summaryProfile,
      model: config.openaiModel,
      source: extractSourceFromUrl(url),
      sections: sectionsMap,
      cost: tokensUsed * (profiles.models[config.openaiModel]?.cost_per_1k_tokens || 0) / 1000
    };
    
    allSummaries.push(summaryData);
    
    // Save individual summary files in multiple formats
    const safeUrl = url.replace(/[^\w\-]+/g, "_").slice(0, 100);
    
    // Save as Markdown
    const summaryPath = path.join(outDir, `${safeUrl}.md`);
    const summaryContent = `# ${articleData.title}

**URL:** ${url}  
**Processed:** ${new Date().toISOString()}  
**Profile:** ${profile.name}  
**Model:** ${model.name}  
**Tokens Used:** ${tokensUsed}

## Summary

${summary}

---
*Generated by Web Article Summarizer Tool*`;
    await fs.writeFile(summaryPath, summaryContent, "utf-8");
    
    // Save as JSON for structured comparison
    const jsonPath = path.join(outDir, `${safeUrl}.json`);
    const jsonContent = {
      metadata: {
        title: articleData.title,
        url: url,
        processed: summaryData.processed,
        profile: config.summaryProfile,
        model: config.openaiModel,
        tokensUsed: tokensUsed,
        contentLength: cleanContent.length,
        cost: tokensUsed * model.cost_per_1k_tokens / 1000
      },
      summary: summary,
      rawContent: cleanContent.substring(0, 1000) // First 1000 chars for reference
    };
    await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2), "utf-8");
    
    // Save as CSV for spreadsheet analysis (row-level file)
    const csvPath = path.join(outDir, `${safeUrl}.${config.openaiModel}.csv`);
    const headerCols = [
      "No","Timestamp","Source","URL","Title","Content Length","Tokens Used","Profile","Model","Cost","Summary",
      ...allSectionNames
    ];
    // Build a single-row CSV with proper quoting
    const buildCsvRow = (row) => row.map(v => {
      const s = (v ?? "").toString();
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",");
    const rowValues = [
      1, // placeholder for single-file row
      summaryData.processed,
      summaryData.source,
      url,
      articleData.title,
      cleanContent.length,
      tokensUsed,
      config.summaryProfile,
      config.openaiModel,
      (tokensUsed * model.cost_per_1k_tokens / 1000).toFixed(6),
      summary,
      ...allSectionNames.map(name => summaryData.sections[name] || "")
    ];
    const singleCsv = headerCols.join(",") + "\n" + buildCsvRow(rowValues) + "\n";
    await fs.writeFile(csvPath, singleCsv, "utf-8");
    
    await page.close();
    
  } catch (error) {
    console.error(`${progress} ❌ Error:`, error.message);
    
    const errorPath = path.join(outDir, `error_${Date.now()}.txt`);
    await fs.writeFile(errorPath, `URL: ${url}\nError: ${error.message}\nTime: ${new Date().toISOString()}`, "utf-8");
  }
}

// Save consolidated output in multiple formats
if (allSummaries.length > 0) {
  // Unified aggregator CSV across runs: output/all_runs.csv
  const aggregatorPath = path.join(outDir, "all_runs.csv");
  const headerCols = [
    "No","Timestamp","Source","URL","Title","Content Length","Tokens Used","Profile","Model","Cost","Summary",
    ...allSectionNames
  ];
  const buildCsvRow = (row) => row.map(v => {
    const s = (v ?? "").toString();
    return `"${s.replace(/"/g, '""')}"`;
  }).join(",");
  let existingLines = 0;
  try {
    const existing = await fs.readFile(aggregatorPath, "utf-8");
    existingLines = Math.max(0, existing.split(/\r?\n/).filter(Boolean).length - 1);
  } catch {}
  const rows = allSummaries.map((s, idx) => buildCsvRow([
    existingLines + idx + 1,
    s.processed,
    s.source,
    s.url,
    s.title,
    s.contentLength,
    s.tokensUsed,
    s.profile,
    s.model,
    (s.cost ?? (s.tokensUsed * (profiles.models[s.model]?.cost_per_1k_tokens || 0) / 1000)).toFixed(6),
    s.summary,
    ...allSectionNames.map(name => s.sections?.[name] || "")
  ]));
  const csvBlock = (existingLines === 0 ? headerCols.join(",") + "\n" : "") + rows.join("\n") + "\n";
  await fs.appendFile(aggregatorPath, csvBlock, "utf-8");
  console.log(`\n📊 Unified CSV updated: ${aggregatorPath}`);
  
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

console.log(`\n🎉 Processing complete!`);
console.log(`📁 Output saved to: ${outDir}`);
console.log(`💰 Total cost: $${(totalTokens * model.cost_per_1k_tokens / 1000).toFixed(4)}`);
console.log(`📊 Processed ${allSummaries.length} articles successfully`);

// Explicit exit to prevent hanging
process.exit(0);