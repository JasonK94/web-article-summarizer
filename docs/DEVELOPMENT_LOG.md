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

---

# General Developer Log (from DEVLOG.md)

This log captures the narrative context, decisions, and reasoning for this project.

## YYYY-MM-DD - Project Initialization
- **Author**: <Your Name>
- **Summary**: Initialized the project using `cinit`.
- **Details**:
  - The initial goal is documented in `context.md`.
  - The plan is to follow the instructions in `NEXT_STEPS.md` to start development.
- **Next Steps**:
  - Enrich `context.md` with more specific details.
  - Start the first development session with the AI agent.

---

## 2025-10-21 - Content Generation Configuration Update
- **Author**: Aether
- **Summary**: Updated the manual content generation plan to use a more advanced model.
- **Details**:
  - Modified `data/3_plans/manual_plan.csv` to switch the default content generation model from `openai/gpt-4o-mini` to `gemini/gemini-2.5-pro`.
  - This was done in response to a request to use a more powerful model for the content synthesis pipeline.
- **Next Steps**:
  - Monitor the output quality and cost implications of using the new model.

---

## 2025-10-21 - Delegated Task Completion by Aria
- **Author**: Aria (AI Research Assistant)
- **Summary**: Completed all tasks outlined in `DELEGATED_TASKS.md`, enhancing the scraping pipeline with specialized handlers for difficult sources.
- **Details**:
  - **Bloomberg Paywall Bypass**: Implemented a solution to bypass the Bloomberg paywall by setting the User-Agent to Googlebot, which is often whitelisted. Added logic to automatically handle the cookie consent dialog to prevent it from interrupting the scraping process.
  - **Authenticated Scraping Framework**: Added a generic framework to handle scraping for sites requiring a login. This involved:
    - Adding an `authentication` section to `config/profiles.json` to manage paths to cookie files.
    - Modifying the core scraping function to load cookies for specific domains before navigating to the page.
    - Creating placeholder cookie files in `config/cookies/` for the user to populate.
  - **YouTube Transcript Extraction**: Integrated the `youtube-transcript` library to directly fetch video transcripts for YouTube URLs. This replaces generic page scraping with a much more accurate and relevant content extraction method for multimodal content.
- **Next Steps**:
  - The user needs to populate the placeholder cookie files with their own browser cookies for authenticated scraping to function correctly.

---

## 2025-10-21 - Legacy Script Archiving
- **Author**: Gemini
- **Summary**: Refactored the `scripts` directory to archive legacy scripts into a `scripts/legacy` subdirectory.
- **Details**:
  - The project has moved towards a streamlined, two-step pipeline (`1_process_raw.js` and `2_generate_content.js`). The previous, more granular scripts were archived to reduce clutter and clarify the current workflow.
  - The following scripts, which represent the older, multi-step workflow, were moved to `scripts/legacy/`:
    - `app.js`: Core summarization script for URLs.
    - `assessor-run.js`: Script for running AI-based quality assessment.
    - `evaluate-models.js`: Script for evaluating and comparing different models.
    - `generate-sns-content.js`: Older script for creating SNS content from summaries.
    - `harvest.js`: The original, careful scraping script for difficult sites.
    - `sns-composer.js`: An earlier version of the SNS content generation script.
    - `sources-run.js`: Core summarization script for manually provided content.
    - `summary-enhancer.js`: A script for refining or enhancing existing summaries.
    - `test-extraction.js`: A utility for testing content extraction.
    - `server.js`: A script likely used for a previous version of the project that had a server component.
    - `logger.js`: A logging utility that was primarily used by the legacy scripts.
- **Next Steps**:
  - The main workflow should now exclusively use the scripts in `scripts/pipeline/`.
  - The `getBloombergUrl.js` script and its duplicate in `delegated_tasks/` should be reviewed to see if they are still needed or should also be archived.

---

## 2025-10-21 - GUI Server Enhancement
- **Author**: Gemini
- **Summary**: Fixed the GUI server script and implemented a configurable port.
- **Details**:
  - The `scripts/server.js` script was crashing due to a module type conflict (`require` used in an ES Module scope). This was corrected by rewriting the server using ES Module `import` syntax.
  - Added command-line argument parsing to `scripts/server.js` to allow the listening port to be configured dynamically using a `-p` or `--port` flag (e.g., `npm run start:gui -- -p 8080`).
- **Next Steps**:
  - The GUI is now stable and can be launched for reviewing content generation runs.

---

## 2025-10-21 - Major Architectural & GUI Overhaul
- **Author**: Gemini
- **Summary**: Refactored the data pipeline to separate outputs and massively upgraded the GUI with interactive controls.
- **Details**:
  - **Pipeline Refactoring**:
    - The `3_edit_content.js` script was modified to save its results to a new, separate file (`data/5_edited/edited_runs.csv`) instead of overwriting the main runs log. This creates a clearer, more robust data flow where each pipeline step has a distinct output.
    - The editor script was also enhanced to be configurable via a `--profile` command-line argument.
  - **GUI Backend Overhaul (`server.js`):**
    - The `/api/runs` endpoint was updated to intelligently merge data from both the draft runs and the new edited runs files, providing a unified view to the frontend.
    - A new `/api/sources` endpoint was created to serve the content of original articles, enabling a drill-down feature.
    - Re-implemented WebSocket (`socket.io`) and child process logic to allow the GUI to trigger and monitor the execution of the pipeline scripts in real-time.
  - **GUI Frontend Overhaul (`index.html`):**
    - Added a "Pipeline Controls" panel with buttons to run the full pipeline or each of the three steps individually.
    - Implemented a live log viewer that displays the stdout/stderr from the running scripts.
    - Made the "Source IDs" for each run clickable, opening a modal window that displays the full text of the original source articles.
  - **Easy Launch:**
    - Created a `start-gui.bat` file for one-click launching of the GUI server on Windows.
- **Next Steps**:
  - The project now has a fully interactive control panel and a more robust, decoupled data architecture.

---

## 2025-10-21 - Pipeline Reconstruction & Stability Overhaul
- **Author**: Gemini
- **Summary**: In response to persistent data corruption and instability, the entire pipeline was refactored with a focus on stability, data integrity, and a robust testing workflow. The GUI was abandoned in favor of a 100% script-based approach.
- **Key Changes**:
  - **Data Integrity First**:
    - The core data handling logic in `2_generate_content.js` and `3_edit_content.js` was completely redesigned to be **append-only**. Scripts now read existing data to prevent duplicates but write new data row-by-row, eliminating overwrite/data loss issues.
    - Explicitly handled UTF-8 BOM writing to occur only on file creation, fixing repeated encoding errors.
  - **Error Resolution**:
    - Fixed a critical `TypeError: toFixed` bug in `logger.js` by making it robustly handle API calls that do not return cost information (like DeepL).
    - Corrected a `404 Not Found` error by fixing a typo in a Gemini model name (`gemini-2.flash` -> `gemini-2.5-flash`).
    - Resolved multiple `ReferenceError` exceptions in pipeline scripts caused by missing variable declarations.
  - **Robust Testing Workflow**:
    - Implemented a `--test` flag across all three pipeline scripts (`1_process_raw`, `2_generate_content`, `3_edit_content`).
    - When `--test` is used, scripts now read/write to dedicated `*_test.csv` files and use fast, cheap models defined in `config/profiles.json` under `test_defaults`.
    - Created ultra-lightweight versions of `processed_content_test.csv` and `manual_plan_test.csv` to ensure test runs complete in seconds.
  - **Context & Self-Correction**:
    - Overhauled `CONTEXT.md` to be a concise source of truth, led by a new **"Caveat" section** mandating checks against past failures before any new work is done.
- **Next Steps**:
  - With a stable and testable pipeline now established, the project is ready for the development of advanced features, such as the "Humanizer" editor.