# Delegated Scraping & Content Extraction Tasks

This document outlines specific scraping challenges to be solved by a specialized agent. The main pipeline script (`1_process_raw.js`) will skip these sources, and this context should be provided to another agent to develop robust, platform-specific solutions.

---

### Task 1: Bypass Bloomberg Paywall

-   **Platform:** `bloomberg.com`
-   **Problem:** The current generic scraper successfully reaches the URL but only extracts a small amount of text (approx. 657 characters), indicating a paywall or anti-bot measure is blocking the main article content.
-   **Goal:** Develop a scraping script that can reliably bypass the Bloomberg paywall to extract the full text of an article.
-   **Context & Tools:** The current project uses `puppeteer-extra` and can leverage a user's Chrome profile via the `CHROME_USER_DATA` environment variable. The solution should be compatible with this framework.

---

### Task 2: Implement Authenticated Scraping for Login-Required Sites

-   **Platforms:** 
    -   `m.blog.naver.com`
    -   `instagram.com`
    -   `threads.com`
    -   `snulife.com`
-   **Problem:** While the current scraper can extract some public content, it cannot access the full range of information that would be available to a logged-in user (e.g., private posts, full comment threads, user-specific content).
-   **Goal:** Create a reusable function or module that can inject authentication cookies or use a stored session to perform scraping as a logged-in user for these platforms.
-   **Context & Tools:** The solution should provide a clear method for a user to provide their authentication details securely (e.g., by pointing to a `cookies.json` file path in the `.env`). The existing `puppeteer` framework should be used.

---

### Task 3: Develop Multimodal Content Extraction for YouTube

-   **Platform:** `youtube.com`
-   **Problem:** The current text-based scraper extracts a large amount of irrelevant page text, including comments and UI elements, but fails to capture the primary content of the video itself (the spoken words).
-   **User Suggestion:** The user suggested investigating specialized tools like **NotebookLM** or other services that can process a YouTube URL and return a transcript or summary.
-   **Goal:** Implement a function that takes a YouTube URL and returns a clean, accurate transcript of the video's content. This function should be called when the `recognizeSource` function identifies a `youtube.com` URL.
-   **Context & Tools:** The implementation may require a new API client (e.g., for a transcript service) and will need a place for the user to configure the relevant API key in the `.env` file.

---
