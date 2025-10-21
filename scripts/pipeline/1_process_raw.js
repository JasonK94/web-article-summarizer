import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import "dotenv/config";
import puppeteerExtra from "puppeteer-extra";
import { YoutubeTranscript } from "youtube-transcript";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { setupGlobalErrorHandling, logEvent } from "../logger.js";
import { fileURLToPath } from 'url';

setupGlobalErrorHandling();

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(process.cwd(), "config", "profiles.json");
const RAW_DIR = path.resolve(process.cwd(), "data", "1_raw");
const PROCESSED_DIR = path.resolve(process.cwd(), "data", "2_processed");
const PROCESSED_FILE_PATH = path.join(PROCESSED_DIR, "processed_content.csv");
const PROCESSED_FILE_PATH_TEST = path.join(PROCESSED_DIR, "processed_content_test.csv");
const TEMP_PROFILE_DIR = path.resolve(process.cwd(), "temp_chrome_profile_main");
const SCRAPING_RULES_PATH = path.join(process.cwd(), 'config', 'scraping_rules.json');

const isTestMode = process.argv.includes('--test');

const SCRAPING_CONFIG = {
  chromeUserData: process.env.CHROME_USER_DATA,
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  timeout: 60000,
};

// --- Main Logic ---

// This function is executed in the browser context
function extractArticleContent(rules) {
    const { hostname } = window.location;
    let siteRule = {};

    // Find the specific rule for the current hostname
    for (const domain in rules.specific_rules) {
        if (hostname.includes(domain)) {
            siteRule = rules.specific_rules[domain];
            break;
        }
    }

    // Combine default and specific rules
    const contentSelector = siteRule.content_selector || rules.default.content_selector;
    const removeSelectors = rules.default.remove_selectors.concat(siteRule.remove_selectors || []);
    
    // Remove unwanted elements
    removeSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(elem => elem.remove());
    });

    let content = '';
    const element = document.querySelector(contentSelector);
    if (element) {
        content = element.textContent;
    }

    // Fallback if specific selector fails or for other sites
    if (!content || content.length < 200) {
        const fallbackElement = document.querySelector(rules.default.fallback_selector);
        if (fallbackElement) {
            content = fallbackElement.textContent;
        }
    }
    
    const cleanContent = content.replace(/\s+/g, ' ').trim();
    return { title: document.title, content: cleanContent };
}

/**
 * Scrapes a single URL for its content.
 * @param {object} browser - The Puppeteer browser instance.
 * @param {string} url - The URL to scrape.
 * @param {object} config - The configuration object.
 * @returns {Promise<{title: string, content: string, status: string}>}
 */
async function scrapeUrl(browser, url, config, scrapingRules) {
  const sourceName = recognizeSource(url);

  if (sourceName === "youtube.com") {
    try {
      console.log(`  🎥 Fetching YouTube transcript for: ${url}`);
      const transcript = await YoutubeTranscript.fetchTranscript(url);
      const content = transcript.map(item => item.text).join(" ");
      
      // Since we don't have a proper title from the transcript, 
      // we might need a separate way to get it, or leave it blank.
      // For now, let's use a placeholder. A proper implementation
      // would use puppeteer to get the title from the page.
      let page;
      let title = "YouTube Video";
      try {
        page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        title = await page.title();
      } catch (e) {
        console.log(`  ⚠️  Could not fetch title for ${url}, using placeholder.`);
      } finally {
        if(page) await page.close();
      }
      
      console.log(`  📄 Extracted ${content.length} characters from YouTube transcript.`);
      return { title: title.replace(/ - YouTube$/, ''), content, status: 'success' };
    } catch (e) {
      console.error(`  ❌ Error fetching YouTube transcript for ${url}: ${e.message}`);
      return { title: 'N/A (Transcript Error)', content: e.message, status: 'failure' };
    }
  }

  let page;
  try {
    page = await browser.newPage();
    
    // Add human-like behavior for Instagram to avoid getting blocked
    if (sourceName === 'instagram.com') {
        console.log("  👤 Applying human-like behavior for Instagram.");
        await page.setViewport({ width: 1280, height: 800 + Math.floor(Math.random() * 100) });
        // Add a small random delay before loading cookies and navigating
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    }

    if (config.authentication && config.authentication[sourceName] && config.authentication[sourceName].cookies_path) {
      const cookiesPath = path.resolve(process.cwd(), config.authentication[sourceName].cookies_path);
      if (existsSync(cookiesPath)) {
        console.log(`  🔑 Loading cookies for ${sourceName}`);
        const cookiesString = await fs.readFile(cookiesPath, "utf-8");
        if(cookiesString && cookiesString.length > 2) { 
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

    if (url.includes("bloomberg.com")) {
      console.log("  🕵️‍♂️ Detected Bloomberg URL, setting User-Agent to Googlebot.");
      await page.setUserAgent(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
      );
    }

    await page.goto(url, { waitUntil: "networkidle2", timeout: SCRAPING_CONFIG.timeout });

    if (url.includes("bloomberg.com")) {
      try {
        const consentButtonSelector = 'button[id^="truste-consent-button"]';
        const consentButton = await page.waitForSelector(consentButtonSelector, { timeout: 10000 });
        if (consentButton) {
          console.log('  🍪 Clicking cookie consent button.');
          await consentButton.click();
          // Wait for a moment to let the page settle after clicking.
          await new Promise(resolve => setTimeout(resolve, 2000)); 
        }
      } catch (e) {
        console.log('  ✅ Cookie consent button not found or timed out, continuing.');
      }
    }
    
    // Pass the rules to the browser context
    const extractedData = await page.evaluate(extractArticleContent, scrapingRules);

    if (!extractedData.content || extractedData.content.length < 200) {
      console.log(`  ⚠️  Warning: Limited content extracted from ${url}`);
    } else {
      console.log(`  📄 Extracted ${extractedData.content.length} characters from ${url}`);
    }
    
    return { ...extractedData, status: 'success' };
  } catch (e) {
    console.error(`  ❌ Error scraping ${url}: ${e.message}`);
    return { title: 'N/A (Scraping Error)', content: e.message, status: 'failure' };
  } finally {
    if (page) await page.close();
  }
}

/**
 * Recognizes the source from a URL.
 * @param {string} url - The URL of the article.
 * @returns {string} The recognized source (e.g., 'wsj', 'nature').
 */
function recognizeSource(url) {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("wsj.com")) return "wsj";
    if (hostname.includes("nature.com")) return "nature";
    if (hostname.includes("linkedin.com")) return "linkedin";
    if (hostname.includes("blog.naver.com")) return "m.blog.naver.com";
    if (hostname.includes("instagram.com")) return "instagram.com";
    if (hostname.includes("threads.net")) return "threads.net";
    if (hostname.includes("snulife.com")) return "snulife.com";
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube.com";
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return "unknown";
  }
}

// --- Main Execution ---
async function main() {
  if (isTestMode) {
    console.log("🧪 RUNNING IN TEST MODE 🧪");
  }
  const processedFilePath = isTestMode ? PROCESSED_FILE_PATH_TEST : PROCESSED_FILE_PATH;

  console.log("🚀 Starting raw content processing...");
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  await logEvent({ event: "pipeline_start", script: "1_process_raw.js" });

  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
  const blocklist = new Set(config.scraping_blocklist || []);

  // --- Load existing processed data ---
  const existingData = new Map();
  let maxProcessedId = 0;
  try {
    await fs.access(processedFilePath);
    const processedCsv = await fs.readFile(processedFilePath, "utf-8");
    const records = csvParse(processedCsv, { columns: true, skip_empty_lines: true });
    for (const record of records) {
      if (record.url) {
        existingData.set(record.url, record.scraping_status);
        const id = parseInt(record.processed_id, 10);
        if (id > maxProcessedId) maxProcessedId = id;
      }
    }
    console.log(`Found ${existingData.size} previously processed URLs.`);
  } catch (e) {
    // File doesn't exist, so we'll create it with headers later
    console.log("No existing processed content file found. A new one will be created.");
  }

  // --- Load raw URLs to be processed ---
  const rawUrlsPath = path.join(RAW_DIR, "urls.csv");
  let records = [];
  try {
      const rawUrlsCsv = await fs.readFile(rawUrlsPath, "utf-8");
      records = csvParse(rawUrlsCsv, { columns: true, skip_empty_lines: true });
  } catch (e) {
      if (e.code === 'ENOENT') {
          console.log("No raw urls.csv file found. Nothing to process.");
          return; // Exit gracefully if no urls.csv
      }
      throw e; // Re-throw other errors
  }

  // --- Puppeteer Setup ---
  let browser;
  let useTempProfile = false;

  // Use the profile copy method if CHROME_USER_DATA is set
  if (SCRAPING_CONFIG.chromeUserData) {
    console.log("🔑 Chrome user data path found. Preparing temporary profile copy...");
    const sourceProfilePath = path.join(SCRAPING_CONFIG.chromeUserData, SCRAPING_CONFIG.chromeProfile);
    try {
      await fs.rm(TEMP_PROFILE_DIR, { recursive: true, force: true });
      await fs.cp(sourceProfilePath, TEMP_PROFILE_DIR, { recursive: true });
      console.log("   ✅ Profile copied successfully.");
      browser = await puppeteerExtra.launch({
        headless: true,
        userDataDir: TEMP_PROFILE_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      useTempProfile = true;
    } catch (e) {
      console.error("   ❌ ERROR: Failed to copy profile. Falling back to temporary profile.", e.message);
      browser = await puppeteerExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    }
  } else {
    console.log("🔒 Using standard temporary profile (authentication will fail).");
    browser = await puppeteerExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }

  try {
    // --- Ensure CSV header exists if the file is new ---
    if (existingData.size === 0) {
      const headers = [
        'processed_id', 'raw_id', 'source_type', 'source_name', 'url', 
        'fetch_date', 'content_date', 'scraping_status', 'title', 
        'keywords', 'content'
      ].join(',');
      await fs.writeFile(processedFilePath, '\ufeff' + headers + '\n', 'utf-8');
    }

    let itemsProcessedThisRun = 0;
    
    // --- Process URLs from urls.csv ---
    const scrapingRules = JSON.parse(await fs.readFile(SCRAPING_RULES_PATH, 'utf-8'));

    for (const record of records) {
      try {
        const url = record.url;
        if (!url) continue;

        // --- Skip if already processed ---
        if (existingData.has(url)) {
          continue;
        }
        
        let newRow;
        const sourceName = recognizeSource(url);
        
        if (blocklist.has(sourceName)) {
          console.log(`🚫 Skipping blocked domain: ${url}`);
          newRow = {
            processed_id: ++maxProcessedId,
            raw_id: record.id || '',
            source_type: 'url',
            source_name: sourceName,
            url: url,
            fetch_date: new Date().toISOString(),
            content_date: '',
            scraping_status: 'blocked_by_config',
            title: 'N/A (Blocked)',
            keywords: '',
            content: 'Content not fetched due to scraping blocklist.',
          };
        } else {
          // --- Scrape Content ---
          const { title, content, status } = await scrapeUrl(browser, url, config, scrapingRules);
          newRow = {
            processed_id: ++maxProcessedId,
            raw_id: record.id || '',
            source_type: 'url',
            source_name: sourceName,
            url: url,
            fetch_date: new Date().toISOString(),
            content_date: '', // TODO: Extract from article
            scraping_status: status,
            title: title,
            keywords: '', // TODO: Extract keywords
            content: content,
          };
        }
        
        // --- Append the new row to the CSV immediately ---
        const csvString = csvStringify([newRow], { header: false, quoted: true });
        await fs.appendFile(processedFilePath, csvString, "utf-8");
        existingData.set(url, newRow.scraping_status); // Update in-memory map
        itemsProcessedThisRun++;

      } catch (e) {
        console.error(`  ❌ CRITICAL FAILURE processing record, skipping: ${JSON.stringify(record)} \n  ${e.message}`);
        // Construct a failure row to ensure we don't try this record again
        const url = record.url || 'unknown_url';
        const newRow = {
          processed_id: ++maxProcessedId,
          raw_id: record.id || '',
          source_type: 'url',
          source_name: recognizeSource(url),
          url: url,
          fetch_date: new Date().toISOString(),
          content_date: '',
          scraping_status: 'critical_failure',
          title: 'N/A (Script Error)',
          keywords: '',
          content: e.stack,
        };
        const csvString = csvStringify([newRow], { header: false, quoted: true });
        await fs.appendFile(processedFilePath, csvString, "utf-8");
        existingData.set(url, 'critical_failure');
        itemsProcessedThisRun++;
      }
    }
    
    console.log(`✅ Processed ${itemsProcessedThisRun} new items this run.`);

  } finally {
    await browser.close();
    console.log("   Browser closed.");

    // Clean up the temporary profile if it was used
    if (useTempProfile) {
      console.log("   Cleaning up temporary profile...");
      await fs.rm(TEMP_PROFILE_DIR, { recursive: true, force: true });
      console.log("      ✅ Cleanup complete.");
    }
  }

  await logEvent({ event: "pipeline_end", script: "1_process_raw.js" });
}

main().catch(error => {
  console.error("An unexpected error occurred:", error);
  process.exit(1);
});
