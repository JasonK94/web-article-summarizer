import "dotenv/config"; // To load environment variables from .env file
import fs from "fs/promises";
import path from "path";
import puppeteerExtra from "puppeteer-extra";

const SCRAPING_CONFIG = {
  chromeUserData: process.env.CHROME_USER_DATA,
  chromeProfile: process.env.CHROME_PROFILE || "Default",
};

async function testChromeSessionScrape() {
    const urlToTest = "https://www.instagram.com/p/DLpQl8WgyJV/?igsh=MWV4cnFnbDg1MmU3eg==";
    
    console.log(`🚀 Testing scrape with your Chrome profile for: ${urlToTest}`);
    
    if (!SCRAPING_CONFIG.chromeUserData) {
        console.error("❌ ERROR: CHROME_USER_DATA is not set in your .env file.");
        console.error("   Please follow the previous instructions to set the path.");
        return;
    }

    console.log(`   Using profile path: ${SCRAPING_CONFIG.chromeUserData}`);

    const browserArgs = [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        `--user-data-dir=${SCRAPING_CONFIG.chromeUserData}`,
        `--profile-directory=${SCRAPING_CONFIG.chromeProfile}`
    ];
    
    const browser = await puppeteerExtra.launch({ 
        headless: true, 
        args: browserArgs 
    });
    
    const page = await browser.newPage();

    try {
        await page.goto(urlToTest, { waitUntil: "networkidle2" });
        
        const content = await page.evaluate(() => {
            const article = document.querySelector('article');
            if (article) {
                // Try to find the main content element in Instagram's post page
                const postContainer = article.querySelector('div[role="button"] > div > div > div:nth-child(2)');
                if (postContainer) return postContainer.textContent.replace(/\s+/g, ' ').trim();
                return article.textContent.replace(/\s+/g, ' ').trim();
            }
            return document.body.textContent.replace(/\s+/g, ' ').trim();
        });

        console.log("\n--- SCRAPE RESULT ---");
        if (content.includes("로그인") || content.includes("가입하기")) {
             console.log("Status: Failed (Detected Login/Signup page)");
        } else {
             console.log("Status: Success");
        }
        console.log(`Content Length: ${content.length}`);
        console.log("\n--- CONTENT PREVIEW ---");
        console.log(content.substring(0, 500) + "...");
        console.log("-----------------------\n");

    } catch (error) {
        console.error(`❌ An error occurred: ${error.message}`);
    } finally {
        await browser.close();
        console.log("✅ Browser closed. Test complete.");
    }
}

testChromeSessionScrape();
