import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import OpenAI from "openai";
import "dotenv/config";

// Load configuration
const profiles = JSON.parse(await fs.readFile("config/profiles.json", "utf-8"));

// Configuration
const config = {
  chromeUserData: process.env.CHROME_USER_DATA || "C:/Users/USER/AppData/Local/Google/Chrome/User Data",
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
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

// Create model-specific output directory to prevent overriding
const modelDir = config.openaiModel.replace(/[^\w\-]/g, "_");
const profileDir = config.summaryProfile;
const outDir = path.resolve("output", modelDir, profileDir);
await fs.mkdir(outDir, { recursive: true });

// Initialize OpenAI client
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    
    // Generate summary using OpenAI
    const summaryResponse = await client.chat.completions.create({
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
    
    const summary = summaryResponse.choices[0].message.content;
    const tokensUsed = summaryResponse.usage?.total_tokens || 0;
    totalTokens += tokensUsed;
    
    console.log(`${progress} ✅ Generated summary (${tokensUsed} tokens)`);
    
    // Store summary data
    const summaryData = {
      title: articleData.title,
      url: url,
      processed: new Date().toISOString(),
      summary: summary,
      contentLength: cleanContent.length,
      tokensUsed: tokensUsed,
      profile: config.summaryProfile,
      model: config.openaiModel
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
    
    // Save as CSV for spreadsheet analysis
    const csvPath = path.join(outDir, `${safeUrl}.csv`);
    const csvContent = `Title,URL,Processed,Summary,Content Length,Tokens Used,Profile,Model,Cost\n"${articleData.title}","${url}","${summaryData.processed}","${summary.replace(/"/g, '""')}",${cleanContent.length},${tokensUsed},"${config.summaryProfile}","${config.openaiModel}",${(tokensUsed * model.cost_per_1k_tokens / 1000).toFixed(6)}`;
    await fs.writeFile(csvPath, csvContent, "utf-8");
    
    await page.close();
    
  } catch (error) {
    console.error(`${progress} ❌ Error:`, error.message);
    
    const errorPath = path.join(outDir, `error_${Date.now()}.txt`);
    await fs.writeFile(errorPath, `URL: ${url}\nError: ${error.message}\nTime: ${new Date().toISOString()}`, "utf-8");
  }
}

// Save consolidated output in multiple formats
if (allSummaries.length > 0) {
  // Save consolidated CSV for spreadsheet analysis
  const csvHeader = "Title,URL,Processed,Summary,Content Length,Tokens Used,Profile,Model,Cost\n";
  const csvRows = allSummaries.map(s => 
    `"${s.title}","${s.url}","${s.processed}","${s.summary.replace(/"/g, '""')}",${s.contentLength},${s.tokensUsed},"${s.profile}","${s.model}",${(s.tokensUsed * model.cost_per_1k_tokens / 1000).toFixed(6)}`
  ).join("\n");
  
  const consolidatedCsv = csvHeader + csvRows;
  const csvPath = path.join(outDir, "all_summaries.csv");
  await fs.writeFile(csvPath, consolidatedCsv, "utf-8");
  console.log(`\n📊 Consolidated CSV saved: ${csvPath}`);
  
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
      cost: s.tokensUsed * model.cost_per_1k_tokens / 1000
    }))
  };
  
  const jsonPath = path.join(outDir, "all_summaries.json");
  await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), "utf-8");
  console.log(`📋 Consolidated JSON saved: ${jsonPath}`);
  
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