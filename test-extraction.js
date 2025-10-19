import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import "dotenv/config";

// Configuration
const config = {
  chromeUserData: process.env.CHROME_USER_DATA || "C:/Users/USER/AppData/Local/Google/Chrome/User Data",
  chromeProfile: process.env.CHROME_PROFILE || "Default",
  timeout: 120000
};

// Load URLs from file
const urls = (await fs.readFile("urls.txt", "utf-8"))
  .split("\n").map(s => s.trim()).filter(Boolean);

const outDir = path.resolve("test_output");
await fs.mkdir(outDir, { recursive: true });

// Launch browser with user session
const browser = await puppeteer.launch({
  headless: true,
  args: [
    `--user-data-dir=${config.chromeUserData}`,
    `--profile-directory=${config.chromeProfile}`
  ]
});

console.log(`Testing content extraction for ${urls.length} URLs...`);

// Process each URL
for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  console.log(`\n[${i + 1}/${urls.length}] Testing: ${url}`);
  
  try {
    const page = await browser.newPage();
    
    // Navigate to the page
    await page.goto(url, { waitUntil: "networkidle2", timeout: config.timeout });
    
    // Wait a bit for dynamic content to load
    await page.waitForTimeout(2000);
    
    // Extract article content
    const articleData = await page.evaluate(() => {
      // Try to find the main article content
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
          if (content.length > 500) break; // Found substantial content
        }
      }
      
      // Fallback: get all text content
      if (!content || content.length < 500) {
        content = document.body.textContent.trim();
      }
      
      return { title, content };
    });
    
    if (!articleData.content || articleData.content.length < 100) {
      console.log("⚠️  Warning: Could not extract substantial content");
    }
    
    // Clean up the content
    const cleanContent = articleData.content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    console.log(`📄 Extracted ${cleanContent.length} characters`);
    console.log(`📰 Title: ${articleData.title}`);
    console.log(`📝 Content preview: ${cleanContent.substring(0, 200)}...`);
    
    // Save extracted content for testing
    const safeUrl = url.replace(/[^\w\-]+/g, "_").slice(0, 100);
    const testPath = path.join(outDir, `${safeUrl}.txt`);
    
    const testContent = `Title: ${articleData.title}
URL: ${url}
Extracted: ${new Date().toISOString()}
Content Length: ${cleanContent.length}

Content:
${cleanContent}`;
    
    await fs.writeFile(testPath, testContent, "utf-8");
    console.log(`✅ Test output saved: ${testPath}`);
    
    await page.close();
    
  } catch (error) {
    console.error(`❌ Error processing ${url}:`, error.message);
  }
}

await browser.close();
console.log("\n🎉 Content extraction test complete! Check the 'test_output' folder for results.");
