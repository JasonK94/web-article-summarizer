import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import puppeteerExtra from "puppeteer-extra";

const CONFIG_PATH = path.resolve(process.cwd(), "config", "profiles.json");
const SCRAPING_CONFIG = {
  timeout: 60000,
};

function recognizeSource(url) {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("blog.naver.com")) return "m.blog.naver.com";
    if (hostname.includes("instagram.com")) return "instagram.com";
    if (hostname.includes("threads.net")) return "threads.net";
    if (hostname.includes("snulife.com")) return "snulife.com";
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return "unknown";
  }
}

function extractArticleContent() {
  document.querySelectorAll('script, style, nav, header, footer').forEach(elem => elem.remove());
  const selectors = ['article', '.se-main-container', '[role="main"]', 'main'];
  let content = '';
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      content = element.textContent.trim();
      if (content.length > 200) break; 
    }
  }
  if (!content || content.length < 200) {
    content = document.body.textContent.trim();
  }
  return { title: document.title, content: content.replace(/\s+/g, ' ').trim() };
}

async function scrapeUrl(browser, url, config) {
  let page;
  try {
    page = await browser.newPage();
    const sourceName = recognizeSource(url);
    if (config.authentication && config.authentication[sourceName] && config.authentication[sourceName].cookies_path) {
      const cookiesPath = path.resolve(process.cwd(), config.authentication[sourceName].cookies_path);
      if (existsSync(cookiesPath)) {
        const cookiesString = await fs.readFile(cookiesPath, "utf-8");
        if(cookiesString && cookiesString.length > 2) { // Check if file is not empty "[]"
            console.log(`  🔑 Loading cookies for ${sourceName}`);
            const cookies = JSON.parse(cookiesString);
            await page.setCookie(...cookies);
        } else {
            console.log(`  ℹ️  Cookie file for ${sourceName} is empty. Proceeding without authentication.`);
        }
      } else {
        console.log(`  ⚠️  Cookie file not found for ${sourceName} at ${cookiesPath}`);
      }
    }
    
    await page.goto(url, { waitUntil: "networkidle2", timeout: SCRAPING_CONFIG.timeout });
    const articleData = await page.evaluate(extractArticleContent);
    return { ...articleData, status: 'success' };
  } catch (e) {
    return { title: 'N/A (Scraping Error)', content: e.message, status: 'failure' };
  } finally {
    if (page) await page.close();
  }
}

async function testAuthScrape() {
    const urlToTest = process.argv[2];
    if (!urlToTest) {
        console.error("Please provide a URL to test.");
        process.exit(1);
    }
    
    console.log(`🚀 Starting authenticated scrape test for: ${urlToTest}`);
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    const browser = await puppeteerExtra.launch({ headless: true });

    try {
        const result = await scrapeUrl(browser, urlToTest, config);
        console.log("\n--- SCRAPE RESULT ---");
        console.log(`Status: ${result.status}`);
        console.log(`Title: ${result.title}`);
        console.log(`Content Length: ${result.content.length}`);
        console.log("\n--- CONTENT PREVIEW ---");
        console.log(result.content.substring(0, 500) + "...");
        console.log("-----------------------\n");
    } finally {
        await browser.close();
    }
}

testAuthScrape();
