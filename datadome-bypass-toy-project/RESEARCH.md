# DataDome Bypass Research & Strategy

This document archives the research findings on how DataDome works and outlines a strategy for bypassing its protections, specifically in the context of this toy project.

## 1. How DataDome Works

Based on public information and experimentation, DataDome employs a multi-layered defense strategy.

### Layer 1: Passive Detection (The "Invisible" Wall)

This layer tries to identify bots without challenging the user.

- **IP Reputation:** Blocks requests from known datacenter or proxy IPs. High-quality residential or mobile proxies are required to bypass this.
- **Browser Fingerprinting:** This is a key technique. DataDome checks dozens of browser attributes to see if they match a real user's environment. This includes:
    - `navigator.webdriver` flag
    - WebGL rendering signatures
    - Canvas hashes
    - AudioContext fingerprints
    - Installed fonts, plugins, and browser extensions
    - Screen resolution and color depth
- **TLS/HTTP Header Analysis:** It analyzes the headers of incoming requests. Mismatches between the `User-Agent` and other headers (like `Accept-Language`), or an unusual order of headers, are red flags.

### Layer 2: Behavioral Analysis

This layer analyzes *how* you interact with the page.

- **Mouse Movement:** Tracks the path and speed of the cursor. Bots tend to move in perfectly straight lines, while humans move in slightly curved, imperfect paths. `ghost-cursor` is essential for mimicking this.
- **Interaction Timing:** Monitors the speed of clicks, typing cadence, and time spent on a page. Unnaturally fast actions are a clear sign of automation.
- **Scroll Patterns:** Analyzes how the user scrolls down the page (e.g., smooth, jerky, using the scroll wheel vs. scrollbar).

### Layer 3: Active Challenges (CAPTCHA)

If the first two layers are suspicious, DataDome presents an active challenge that requires user interaction. This is what we encountered on `allegro.pl`.

- **Slider Puzzles:** The user must drag a puzzle piece to fit into a gap. This is a common and effective challenge.
- **Image Recognition:** Classic "select all traffic lights" style challenges (similar to reCAPTCHA).
- **Rotation Puzzles:** The user must rotate an object to its correct orientation.
- **Simple Checkboxes:** The easiest form, often presented if the bot's "suspicion score" is low.

## 2. Bypass Techniques & Strategies

A successful bypass requires addressing all three layers.

### For Passive Detection & Behavioral Analysis:

- **Use a high-quality proxy:** A residential or mobile proxy is non-negotiable for serious attempts.
- **Use a stealthy browser automation library:** `playwright-extra` with the `stealth` plugin is a good open-source starting point. It attempts to patch many of the most common fingerprinting detection vectors.
- **Use `ghost-cursor`:** This is mandatory to pass behavioral analysis checks related to mouse movement.
- **Add realistic delays:** Use `waitForTimeout` strategically to mimic human reading/decision time. Don't let the script run as fast as possible.

### For Active Challenges (CAPTCHA):

This is the hardest part and where our initial script failed.

1.  **CAPTCHA Solving Services (The Realistic Approach):**
    - **How it works:** Use a paid API service like [2Captcha](https://2captcha.com/) or [Anti-Captcha](https://anti-captcha.com/). When a CAPTCHA is detected, the script sends the puzzle image (and any instructions) to the service. The service has human workers or AI solve it and returns the answer (e.g., coordinates for a slider, text to type).
    - **Pros:** Highly effective, works for almost all CAPTCHA types.
    - **Cons:** Costs money, adds an external dependency and latency.

2.  **Computer Vision (CV) Self-Solve (The Experimental Approach):**
    - **How it works:** Use a library like OpenCV (or a lighter Node.js equivalent like `Jimp`) to analyze a screenshot of the puzzle.
    - **Example (Slider Puzzle):**
        1.  Take a screenshot of the puzzle area.
        2.  Use edge detection to find the outlines of the puzzle piece and the target slot.
        3.  Use template matching to find the exact coordinates of the target slot.
        4.  Calculate the horizontal distance between the piece's starting point and the target.
        5.  Use Playwright/`ghost-cursor` to drag the slider by that calculated distance.
    - **Pros:** No external cost, fully autonomous.
    - **Cons:** Very brittle. A small change in the puzzle's color, shape, or size can break the CV logic. It must be custom-built for each specific type of puzzle.

## 3. Strategy for This Toy Project

Given the goal is to "establish a method" for `allegro.pl` rather than build a universal solver, we will pursue the **Experimental Computer Vision Approach**.

- We will focus specifically on solving the slider puzzle presented by `allegro.pl`.
- We will add a CV library (`Jimp`) to the project.
- The script will be updated to:
    1.  Detect the appearance of the DataDome CAPTCHA `iframe`.
    2.  Take a screenshot of the puzzle.
    3.  Analyze the image to find the puzzle piece and the target location.
    4.  Calculate the required drag distance.
    5.  Perform a human-like drag with `ghost-cursor`.

This approach is a great learning exercise and, if successful, will create a truly autonomous (though site-specific) solution for our target.

