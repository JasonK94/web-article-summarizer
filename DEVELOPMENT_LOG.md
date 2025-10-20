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
