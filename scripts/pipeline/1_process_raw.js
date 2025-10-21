import fs from "fs/promises";
import path from "path";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import "dotenv/config";
import { setupGlobalErrorHandling, logEvent } from "../logger.js";

setupGlobalErrorHandling();

const RAW_DIR = path.resolve(process.cwd(), "data", "1_raw");
const PROCESSED_DIR = path.resolve(process.cwd(), "data", "2_processed");
const PROCESSED_FILE_PATH = path.join(PROCESSED_DIR, "processed_content.csv");

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
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return "unknown";
  }
}

async function main() {
  console.log("🚀 Starting raw content processing...");
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  await logEvent({ event: "pipeline_start", script: "1_process_raw.js" });

  const rawUrlsPath = path.join(RAW_DIR, "urls.csv");
  
  let processedItems = [];
  let newIdCounter = 1;

  // --- Process URLs from urls.csv ---
  try {
    const urlsCsv = await fs.readFile(rawUrlsPath, "utf-8");
    const records = csvParse(urlsCsv, { columns: true, skip_empty_lines: true });

    for (const record of records) {
      const url = record.url;
      if (!url) continue;

      // TODO: Implement actual scraping logic here. For now, it's a placeholder.
      const scrapingSuccessful = true; 
      const content = `Placeholder content for ${url}`;
      const title = `Placeholder Title for ${url}`;

      processedItems.push({
        processed_id: newIdCounter++,
        raw_id: record.id || '',
        source_type: 'url',
        source_name: recognizeSource(url),
        url: url,
        fetch_date: new Date().toISOString(),
        content_date: '', // TODO: Extract from article
        scraping_status: scrapingSuccessful ? 'success' : 'failure',
        title: title,
        keywords: '', // TODO: Extract keywords
        content: content,
      });
    }
  } catch (e) {
    console.error(`Could not process ${rawUrlsPath}: ${e.message}`);
  }

  // --- Process Manual Sources (sources.csv) ---
  // TODO: Add logic to process `sources.csv` in a similar way.
  
  // --- Write to processed_content.csv ---
  if (processedItems.length > 0) {
    const csvString = csvStringify(processedItems, { header: true });
    await fs.writeFile(PROCESSED_FILE_PATH, csvString, "utf-8");
    console.log(`✅ Successfully processed ${processedItems.length} items.`);
    console.log(`📝 Standardized output written to: ${PROCESSED_FILE_PATH}`);
  } else {
    console.log("No new items to process.");
  }

  await logEvent({ event: "pipeline_end", script: "1_process_raw.js", items_processed: processedItems.length });
}

main();
