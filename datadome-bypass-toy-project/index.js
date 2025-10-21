const { chromium } = require('playwright');
const { createCursor } = require("ghost-cursor");
const Jimp = require('jimp');
const path = require('path');

const captchaScreenshotPath = path.join(__dirname, 'captcha.png');
const puzzlePiecePath = path.join(__dirname, 'puzzle.png');
const puzzleBackgroundPath = path.join(__dirname, 'background.png');

async function isCaptchaVisible(page) {
    try {
        const captchaFrame = page.frame({ name: 'datadome-captcha-popup' });
        if (!captchaFrame) return false;
        
        await captchaFrame.waitForSelector('#captcha-container', { state: 'visible', timeout: 5000 });
        console.log('CAPTCHA is visible.');
        return true;
    } catch (error) {
        // console.log('CAPTCHA not visible or timed out.');
        return false;
    }
}

async function solveSliderCaptcha(page) {
    console.log('Attempting to solve slider CAPTCHA...');
    try {
        const captchaFrame = page.frame({ name: 'datadome-captcha-popup' });
        if (!captchaFrame) {
            console.log('CAPTCHA frame not found.');
            return false;
        }

        const captchaContainer = await captchaFrame.$('#captcha-container');
        if (!captchaContainer) {
            console.log('CAPTCHA container not found.');
            return false;
        }

        // 1. Take a screenshot of the CAPTCHA area
        await captchaContainer.screenshot({ path: captchaScreenshotPath });
        
        // 2. Isolate puzzle piece and background using known selectors/positions
        // These values are estimates and may need fine-tuning
        const puzzleImage = await Jimp.read(captchaScreenshotPath);
        const pieceImage = puzzleImage.clone().crop(25, 175, 60, 60); // x, y, width, height
        await pieceImage.writeAsync(puzzlePiecePath);
        
        const backgroundImage = puzzleImage.clone().crop(25, 45, 280, 110);
        await backgroundImage.writeAsync(puzzleBackgroundPath);

        // 3. Find the target location using image processing
        const background = await Jimp.read(puzzleBackgroundPath);
        const piece = await Jimp.read(puzzlePiecePath);

        // Convert to grayscale and find edges to make matching more reliable
        background.grayscale().contrast(1).filter(Jimp.EDGE_EXTEND);
        piece.grayscale().contrast(1).filter(Jimp.EDGE_EXTEND);

        let bestMatch = { x: 0, y: 0, distance: Infinity };

        // Brute-force search for the best match location (simple template matching)
        for (let x = 0; x < background.bitmap.width - piece.bitmap.width; x++) {
            for (let y = 0; y < background.bitmap.height - piece.bitmap.height; y++) {
                const distance = Jimp.distance(background.clone().crop(x, y, piece.bitmap.width, piece.bitmap.height), piece);
                if (distance < bestMatch.distance) {
                    bestMatch = { x, y, distance };
                }
            }
        }
        
        // The best match X-coordinate is our target
        const targetX = bestMatch.x;
        console.log(`Puzzle piece target location found at x: ${targetX}`);

        // 4. Perform the drag action
        const sliderHandle = await captchaFrame.$('.captcha_slider_knob');
        if (!sliderHandle) {
            console.log('Could not find slider handle.');
            return false;
        }

        const sliderBoundingBox = await sliderHandle.boundingBox();
        const cursor = createCursor(page);

        const startPoint = {
            x: sliderBoundingBox.x + sliderBoundingBox.width / 2,
            y: sliderBoundingBox.y + sliderBoundingBox.height / 2
        };

        const endPoint = {
            x: startPoint.x + targetX,
            y: startPoint.y
        };

        console.log(`Manually dragging slider from ${Math.round(startPoint.x)} to ${Math.round(endPoint.x)}`);

        // Low-level drag and drop to avoid ghost-cursor internal issues
        await cursor.move(sliderHandle);
        await page.mouse.down();
        await page.waitForTimeout(200); // Small pause
        await cursor.moveTo(endPoint);
        await page.mouse.up();

        console.log('Drag complete. Waiting for navigation...');
        
        // After dropping, wait for the page to navigate
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 });

        console.log('Navigation detected after dragging. Checking if CAPTCHA is gone...');

        if (await isCaptchaVisible(page)) {
            console.log('CAPTCHA is still visible after solve attempt. Failed.');
            return false;
        } else {
            console.log('CAPTCHA appears to be solved successfully!');
            return true;
        }

    } catch (error) {
        console.error('An error occurred during CAPTCHA solving:', error);
        return false;
    }
}

async function handleFullCaptchaProcess(page) {
    console.log('A multi-stage CAPTCHA process is suspected. Starting handler...');
    try {
        const captchaFrame = page.frame({ name: 'datadome-captcha-popup' });
        if (!captchaFrame) {
            console.log('Could not find the CAPTCHA frame to begin the process.');
            return false;
        }

        // Stage 1: Look for an initial confirmation button
        // It might be a button or a clickable div with specific text.
        // We will try a few common selectors.
        const confirmButtonSelectors = [
            'button:has-text("Confirm")',
            'button:has-text("Verify")',
            '#btn-interstitial' // A common ID for such buttons
        ];

        let confirmed = false;
        for (const selector of confirmButtonSelectors) {
            try {
                const button = captchaFrame.locator(selector).first();
                const count = await button.count();
                if (count > 0) {
                    console.log(`Found initial confirmation button with selector: ${selector}. Clicking...`);
                    await button.click({ timeout: 5000 });
                    confirmed = true;
                    break; 
                }
            } catch (e) {
                // Selector not found, try the next one
            }
        }

        if (confirmed) {
            console.log('Initial confirmation clicked. Waiting for puzzle to load...');
            await page.waitForTimeout(3000); // Give time for the slider to appear
        } else {
            console.log('Did not find a separate initial confirmation button. Assuming slider is ready.');
        }

        // Stage 2: Solve the slider puzzle
        return await solveSliderCaptcha(page);

    } catch (error) {
        console.error('An error occurred during the multi-stage CAPTCHA process:', error);
        return false;
    }
}


async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  const cursor = createCursor(page);

  try {
    console.log('Navigating to allegro.pl...');
    try {
        await page.goto('https://allegro.pl/', { waitUntil: 'networkidle', timeout: 20000 });
    } catch (error) {
        if (error.message.includes('net::ERR_ABORTED')) {
            console.log('Navigation was interrupted, likely by DataDome. Checking for CAPTCHA...');
        } else {
            console.log('An error occurred during navigation, but continuing to check for CAPTCHA.', error.message);
        }
    }


    if (await isCaptchaVisible(page)) {
        const solved = await handleFullCaptchaProcess(page);
        if (!solved) {
            throw new Error("Failed to solve the multi-stage CAPTCHA. Aborting.");
        }
    }

    console.log('Successfully on the main page (or CAPTCHA was solved).');

    try {
      const acceptButtonSelector = 'button[data-role="accept-consent"]';
      await page.waitForSelector(acceptButtonSelector, { timeout: 10000 });
      console.log('Cookie consent button found. Clicking...');
      await cursor.click(acceptButtonSelector);
      console.log('Cookie banner handled.');
    } catch (error) {
      console.log('Did not find cookie banner or already accepted.');
    }
    
    console.log('Waiting for page to stabilize...');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Extra wait for client-side scripts

    // Main task: Search for a product
    console.log('Searching for "laptop"...');
    const searchInputSelector = 'input[data-role="search-input"]';
    const searchButtonSelector = 'button[data-role="search-button"]';

    await page.waitForSelector(searchInputSelector, { timeout: 10000 });
    await cursor.click(searchInputSelector);
    await page.type(searchInputSelector, 'laptop', { delay: 120 });
    
    await page.waitForSelector(searchButtonSelector);
    await cursor.click(searchButtonSelector);

    console.log('Waiting for search results...');
    await page.waitForNavigation({ waitUntil: 'networkidle' });

    if (await isCaptchaVisible(page)) {
        console.log('CAPTCHA appeared after search. Attempting to solve...');
        const solved = await handleFullCaptchaProcess(page);
        if (!solved) {
            throw new Error("Failed to solve CAPTCHA after search. Aborting.");
        }
        await page.waitForLoadState('networkidle'); // Wait for page to reload after captcha
    }

    console.log('Successfully loaded search results.');
    
    console.log('Extracting product titles...');
    const productTitleSelector = 'h2[class^="m7er_k4"] a';
    await page.waitForSelector(productTitleSelector, { timeout: 15000 });
    
    const productTitles = await page.locator(productTitleSelector);
    const productCount = await productTitles.count();
    console.log(`Found ${productCount} products.`);

    const productsToScrape = Math.min(5, productCount);
    console.log(`Scraping top ${productsToScrape} titles:`);
    for (let i = 0; i < productsToScrape; i++) {
        const productTitle = await productTitles.nth(i).textContent();
        console.log(`- ${productTitle.trim()}`);
    }

  } catch (error) {
    console.error('A critical error occurred in the main flow:', error);
    await page.screenshot({ path: 'datadome-bypass-toy-project/error.png', fullPage: true });
  } finally {
    console.log('Closing the browser.');
    await browser.close();
  }
}

main().catch(console.error);
