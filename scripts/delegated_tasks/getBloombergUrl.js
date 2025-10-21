import puppeteer from "puppeteer";

async function getBloombergArticleUrl() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log("Navigating to Bloomberg homepage...");
    await page.goto("https://www.bloomberg.com/", { waitUntil: "networkidle2" });

    console.log("Waiting for a main news link...");
    // This selector might need adjustment if the site structure changes.
    // It targets a link within a story container.
    const articleSelector = 'article a';
    await page.waitForSelector(articleSelector);

    const articleUrl = await page.evaluate((selector) => {
      const link = document.querySelector(selector);
      return link ? link.href : null;
    }, articleSelector);

    if (articleUrl) {
      console.log(`Found article URL: ${articleUrl}`);
    } else {
      console.log("Could not find an article URL with the specified selector.");
    }

  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await browser.close();
  }
}

getBloombergArticleUrl();
