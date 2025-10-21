# DataDome Bypass Toy Project

This project is a proof-of-concept to demonstrate bypassing the DataDome bot protection service. It is based on the techniques described in the [Kameleo blog post: Guide to Bypassing DataDome in 2025](https://kameleo.io/blog/guide-to-bypassing-datadome).

**Disclaimer:** This project is for educational purposes only. Web scraping may be against the terms of service of some websites. Please use this code responsibly.

## How it Works

The script uses a combination of tools and techniques to appear more like a human user and less like an automated bot:

1.  **`playwright-extra` with `plugin-stealth`**: This is a version of Playwright with added measures to hide browser automation. The stealth plugin applies various patches to evade common bot-detection scripts. This serves as a lightweight, free alternative to a dedicated anti-detect browser like Kameleo for this toy project.

2.  **`ghost-cursor`**: DataDome's behavioral analysis is a key defense layer. This library simulates realistic human mouse movements, generating curved paths and random "jitters" instead of instantaneous, straight-line movements that bots typically make. We use it for all navigation and clicks.

3.  **Headed Browser & Full Viewport**: The script runs in a headed (non-headless) mode and maximizes the browser window. This mimics a more typical user environment.

4.  **Targeted Scraping**: The script follows the case study in the article, targeting the UK Footlocker website, which is known to be protected by DataDome.

## Limitations

This is a simplified demonstration and has several limitations compared to a production-grade bypass solution:

*   **No Proxies**: The script runs from your local IP address. For robust scraping, a pool of high-quality residential or mobile proxies is essential to avoid IP-based blocking, as highlighted in the article.
*   **No CAPTCHA Solving**: If the script fails to bypass the initial checks and is presented with a CAPTCHA, it will fail. A real-world solution would need to integrate a CAPTCHA-solving service.
*   **Inconsistent Results**: Bot detection is a cat-and-mouse game. This script might work one day and fail the next if DataDome updates its detection algorithms. Sometimes, simply running it again is enough to succeed.

## How to Run

1.  **Clone the repository (or ensure the files are in the `datadome-bypass-toy-project` directory).**

2.  **Install dependencies:**
    Open a terminal in the project directory and run:
    ```bash
    npm install
    ```
    This will also download the necessary browser binaries for Playwright.

3.  **Run the script:**
    ```bash
    npm start
    ```

You will see a Chromium browser window open and navigate to the website, performing the automated steps. The console will log the progress.

