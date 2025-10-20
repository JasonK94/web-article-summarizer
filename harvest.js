import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import "dotenv/config";
import { logEvent, logServer, makeRateCounter } from "./logger.js";

const runId = new Date().toISOString().replace(/[:.]/g, '-');
await logEvent({ tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId });

const config = {
  chromeUserDataDir: process.env.CHROME_USER_DATA_DIR,
  chromeProfileDir: process.env.CHROME_PROFILE_DIR,
  timeout: 60000,
  minDelayMs: parseInt(process.env.HARVEST_MIN_DELAY_MS, 10) || 3000,
  maxDelayMs: parseInt(process.env.HARVEST_MAX_DELAY_MS, 10) || 7000,
  maxUrlsPerHour: parseInt(process.env.HARVEST_MAX_URLS_PER_HOUR, 10) || 10,
  proxyList: (process.env.HARVEST_PROXY_LIST || "").split(',').map(p => p.trim()).filter(Boolean)
};

if (!config.chromeUserDataDir) {
  console.error("CHROME_USER_DATA_DIR is not set in .env. This is required to use your existing browser session and VPN state.");
  process.exit(1);
}

const randInt = (min,max) => Math.floor(min + Math.random()*(max-min+1));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function moveMouseLikeHuman(page) {
  const startX = Math.random() * 500 + 100;
  const startY = Math.random() * 500 + 100;
  await page.mouse.move(startX, startY, { steps: 10 });
  await sleep(randInt(100, 300));

  const intermediateX = startX + (Math.random() - 0.5) * 200;
  const intermediateY = startY + (Math.random() - 0.5) * 200;
  await page.mouse.move(intermediateX, intermediateY, { steps: 15 });
  await sleep(randInt(200, 500));
}

function extractHost(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return 'unknown'; } }

async function loadUrlList(){
  try {
    const csv = await fs.readFile("urls.csv","utf-8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const out = [];
    for (let i=1;i<lines.length;i++){
      const parts = lines[i].split(/,(.+)/);
      if (!parts[1]) continue;
      out.push({ id: parts[0].trim(), url: parts[1].trim() });
    }
    return out;
  } catch {}
  const txt = (await fs.readFile("urls.txt","utf-8")).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return txt.map((u,i)=>({ id: String(i+1), url: u }));
}

const archiveDir = path.resolve("archive","pages");
await fs.mkdir(archiveDir,{recursive:true});
const indexPath = path.resolve("archive","archive_index.csv");
try { await fs.access(indexPath); } catch { await fs.writeFile(indexPath, "id,timestamp,source,url,type,path\n", "utf-8"); }

puppeteerExtra.use(StealthPlugin());

const urls = await loadUrlList();
await logEvent({ tag: "harvest:start", count: urls.length });
const bump = makeRateCounter();
const recentRequestTimestamps = [];

for (let i=0;i<urls.length;i++){
  // --- Rate Limiting Logic ---
  const now = Date.now();
  while (recentRequestTimestamps.length > 0 && recentRequestTimestamps[0] < now - 3600000) {
    recentRequestTimestamps.shift(); // Remove timestamps older than 1 hour
  }
  if (recentRequestTimestamps.length >= config.maxUrlsPerHour) {
    const nextRequestTime = recentRequestTimestamps[0] + 3600000;
    const waitTime = nextRequestTime - now;
    if (waitTime > 0) {
      console.log(` hourly rate limit (${config.maxUrlsPerHour}/hr) reached. Waiting for ${Math.round(waitTime / 60000)} minutes...`);
      await sleep(waitTime);
    }
  }

  const { id, url } = urls[i];
  const host = extractHost(url);
  console.log(`[${i+1}/${urls.length}] Harvesting ${url}`);

  let browser;
  try {
    const launchOptions = {
      headless: false,
      args: [
        `--user-data-dir=${config.chromeUserDataDir}`,
        `--profile-directory=${config.chromeProfileDir || 'Default'}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080'
      ],
      defaultViewport: null
    };

    if (config.proxyList.length > 0) {
      const proxy = config.proxyList[Math.floor(Math.random() * config.proxyList.length)];
      console.log(`  > Using proxy: ${proxy}`);
      launchOptions.args.push(`--proxy-server=${proxy}`);
    }

    browser = await puppeteerExtra.launch(launchOptions);
    const page = await browser.newPage();
    
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: config.timeout });
    
    // --- Initial wait and content verification ---
    console.log("  > Page loaded. Waiting to ensure stability and avoid early detection...");
    await sleep(randInt(config.minDelayMs, config.maxDelayMs) + 2000); // Longer initial wait

    const mainContentSelector = 'article, main, [role="main"]';
    const contentCheck = await page.evaluate((selector) => {
      return document.querySelector(selector) && document.querySelector(selector).innerText.length > 500;
    }, mainContentSelector);

    if (!contentCheck) {
      const isBlocked = await page.evaluate(() => /captcha|robot|block|access denied|Just a moment.../i.test(document.body.innerText));
      if (isBlocked) {
         // Save debug info for blocked pages
        const debugDir = path.resolve("logs", "failed_harvest");
        await fs.mkdir(debugDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeUrl = url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);
        const screenshotPath = path.join(debugDir, `FAIL_${timestamp}_${safeUrl}.png`);
        const htmlPath = path.join(debugDir, `FAIL_${timestamp}_${safeUrl}.html`);
        
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const html = await page.content();
        await fs.writeFile(htmlPath, html, 'utf-8');
        
        throw new Error(`Blocked by CAPTCHA/security page. Debug info saved to logs/failed_harvest/`);
      }
    }
    console.log("  > Content verified. Proceeding with human-like interactions.");
    recentRequestTimestamps.push(Date.now());
    
    const startTs = Date.now();
    const counts = bump(host);
    await logServer({ tag: "harvest:goto", host, url, dur_ms: Date.now()-startTs, counts });
    
    // Complex human-like interactions
    await sleep(randInt(config.minDelayMs, config.maxDelayMs));
    await moveMouseLikeHuman(page);

    // Move mouse over a RANDOM element to simulate reading
    const hoverableElements = await page.$$('p, h2, a, img');
    if (hoverableElements.length > 0) {
      const randomEl = hoverableElements[Math.floor(Math.random() * hoverableElements.length)];
      await randomEl.hover();
      await sleep(randInt(500, 1500));
    }

    // Scroll down multiple times, with a chance to scroll up slightly
    for (let i=0; i < 2 + Math.random()*4; i++){
      await page.evaluate(() => window.scrollBy(0, Math.round(400 + Math.random()*800)));
      await sleep(randInt(800, 2000));
      if (Math.random() < 0.2) { // 20% chance to scroll up a bit
        await sleep(randInt(200, 500)); // "thinking time" before scrolling up
        await page.evaluate(() => window.scrollBy(0, -Math.round(100 + Math.random()*200)));
        await sleep(randInt(500, 1500));
      }
    }

    await moveMouseLikeHuman(page);
    await sleep(randInt(1000, 3000));

    const finalHtml = await page.content(); // Get final HTML after interactions
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const base = `${ts}_${url.replace(/[^a-zA-Z0-9]/g,'_').slice(0,100)}`;
    const archiveHtmlPath = path.join(archiveDir, `${base}.html`);
    await fs.writeFile(archiveHtmlPath, finalHtml, "utf-8");

    // Avoid page.pdf(); if needed, use browser's print-to-pdf via DevTools protocol
    const pdfPath = null;
    // const pdfPath = path.join(archiveDir, `${base}.pdf`);
    // await page.pdf({ path: pdfPath, printBackground: true, format: "Letter" });

    // Append to index
    const line = `${id},${new Date().toISOString()},${host},${url},html,${path.relative(process.cwd(), archiveHtmlPath)}\n`;
    await fs.appendFile(indexPath, line, "utf-8");
    console.log(`  ✓ Archived: ${archiveHtmlPath}`);
    await logEvent({ tag: "harvest:archived", id, url, htmlPath: archiveHtmlPath, pdfPath });
  } catch(e){
    console.log(`  ✗ Error: ${e.message}`);
    await logEvent({ tag: "harvest:error", url, message: e.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await logEvent({ tag: "harvest:end", runId });
console.log("Harvest complete.");
process.exit(0);


