# Development History & Lessons Learned

This document tracks the major development and debugging phases of the web article summarizer project. Its purpose is to prevent repeating past mistakes and to provide context for future development.

## v1: The Initial Block (Early Scraping Attempts)

- **Strategy**: Used `puppeteer.launch` with basic settings to navigate to article URLs.
- **Result**: Immediately blocked by a sophisticated CAPTCHA page.
- **Analysis**: Log analysis revealed the blocking entity was **DataDome**, a powerful anti-bot solution. It became clear that basic Puppeteer usage was easily detectable.

## v2: The Stealth Era (Fighting Fingerprinting)

- **Strategy**:
  1. Introduced `puppeteer-extra` with `puppeteer-extra-plugin-stealth` to mask common automation fingerprints (e.g., `navigator.webdriver`).
  2. Implemented more "human-like" interactions: randomized delays, complex scrolling patterns, and realistic mouse movements.
  3. Switched from `puppeteer.launch` to `puppeteer.connect`, assuming that connecting to a user-initiated browser would be less detectable.
- **Result**: Still blocked. This phase introduced significant instability, with frequent `ERR_CONNECTION_REFUSED` errors related to the remote debugging port.
- **Analysis**:
  - Created `check-fingerprint.js` for diagnostics.
  - **Key Finding**: The fingerprinting itself was not the primary issue. The stealth plugin worked remarkably well, making the automated browser nearly identical to a manual one.
  - The connection issues were traced back to conflicts with existing Chrome processes and profile settings, not the script's logic.

## v3: The IP Saga (The Real Culprit)

- **Hypothesis**: The blocking must be due to the IP address, as fingerprinting was ruled out. The user was using a VPN, so it was assumed the script was also using the VPN IP.
- **Strategy**:
  1. Created `check-ip.js` to definitively verify the public IP address used by the script-launched browser instance.
  2. The script launched Chrome using the user's default profile (`--user-data-dir`), the same environment where the VPN was confirmed to be working.
- **Result**:
  - **Manual Browser IP (VPN ON):** `160.238.37.67`
  - **Script-controlled Browser IP:** `147.47.229.99` (The user's real, fixed IP)
- **Final Conclusion**: **The root cause of all blocking was that Puppeteer was bypassing the system's VPN and exposing the real IP address.** All behavioral enhancements were useless because the fundamental identity of the scraper was never hidden.

---

## Current Status & Next Steps

- **Status**: Waiting for the IP block from WSJ/DataDome to expire.
- **Path Forward**: The IP issue MUST be solved before any further scraping attempts. The most promising solutions are:
  1. **Configure and Force a Proxy**: The most reliable method.
     - **Option A (VPN's Proxy):** Find the SOCKS5 proxy address provided by the user's VPN application and force Puppeteer to use it via the `--proxy-server` launch argument.
     - **Option B (SSH Tunneling):** Use a known clean IP (`147.47.229.113`) to create an SSH tunnel and route traffic through it as a SOCKS5 proxy.
  2. **Resolve OS-level Network Routing**: A more complex solution involving changing the OS's network settings to ensure all traffic from the user's profile is forced through the VPN, though this seems less reliable.

**Core Lesson Learned**: **Verify, don't assume.** We assumed the VPN was working for the script because it worked for the user's manual browser. A simple diagnostic test (`check-ip.js`) at the beginning would have saved days of effort spent on solving the wrong problem (behavioral analysis).

---

# Project: DataDome Bypass Toy Project (Playwright)

This project was a focused effort to explore modern anti-bot bypass techniques using Playwright, moving beyond the IP-related issues discovered in the previous project.

## v4: The Human Simulation Era (Playwright & Ghost-Cursor)

- **Intent**: To build a toy project based on a [Kameleo blog post](https://kameleo.io/blog/guide-to-bypassing-datadome), using Playwright and `ghost-cursor` to mimic human behavior and test against known DataDome-protected sites.
- **Strategy**:
  1. Start with simpler targets (`Footlocker`, `Ticketmaster`) to establish a baseline for handling common obstacles like cookie consent banners.
  2. Escalate to a known difficult target, `allegro.pl`, to test the robustness of the solution.
  3. Use `ghost-cursor` to generate realistic, non-linear mouse movements for all interactions.
- **Result**: The script successfully handled basic interactions on the initial sites but was completely stopped by a complex, multi-stage CAPTCHA on `allegro.pl`. The initial script was unable to even detect the challenge.

## v5: The CAPTCHA Arms Race (Computer Vision & Multi-Stage Logic)

- **Analysis**: The breakthrough came from direct user feedback, which revealed the CAPTCHA process: an initial "Confirm" button followed by a slider puzzle. This highlighted the limitations of purely automated analysis for complex, interactive challenges. The `net::ERR_ABORTED` navigation error was correctly re-diagnosed as DataDome's script interception, not a simple network failure.
- **Strategy**:
  1. **Multi-Stage Handling**: Developed a dedicated function (`handleFullCaptchaProcess`) to manage the sequential nature of the CAPTCHA.
  2. **Computer Vision (CV)**: Implemented a CV-based slider solver (`solveSliderCaptcha`) using the `jimp` library. This involved screenshotting the puzzle, programmatically identifying the target location, and calculating the required drag distance.
  3. **Low-Level Interaction**: Replaced `ghost-cursor`'s high-level `dragAndDrop` with a more reliable low-level sequence of Playwright mouse events (`mouse.down`, `mouse.move`, `mouse.up`) to work around library-specific errors.
- **Result**: The final script successfully integrated the multi-stage CAPTCHA logic. However, it still failed with a `TimeoutError` on `allegro.pl`. This suggests that DataDome employs further countermeasures (e.g., dynamic rendering that prevents the page from reaching a stable `networkidle` state) that disrupt the script's ability to interact with page elements, even after the primary CAPTCHA challenge is addressed.

**Core Lesson Learned**: Bypassing advanced bot protection is a multi-layered problem. While solving the visible CAPTCHA is a major part, success also depends on surviving a hostile JavaScript environment designed to detect and disrupt automation at every step. For these complex cases, collaborative debugging (human observation + AI implementation) is far more effective than relying on purely automated attempts.