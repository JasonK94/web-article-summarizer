# AI Assistant Context: Content Generation Pipeline

## Agent Caveats & Meta-Rules (MUST READ BEFORE EVERY ACTION)

**This section documents past failures to prevent repetition. Any mistake made more than twice MUST be added to this list.**

1.  **Check Environment First (Assume Nothing):** Always check `docs/DEVELOPMENT_LOG.md` and the file tree for recent changes by other agents before modifying code. Do not assume a previous state. *Failure to do this caused repeated `ERR_MODULE_NOT_FOUND` errors.*

2.  **Append, Don't Overwrite:** All data logging to `.csv` files MUST use an append-only strategy. Scripts should check for existing data to prevent duplicates but add new data row-by-row (`appendFile`). *Failure to do this caused data loss risks.*

3.  **Handle APIs Defensively:** All external API calls must assume that fields can be missing or values can be different. Hardcoded values like model names must be avoided; pull them from `config/profiles.json`. *Failure to do this caused `TypeError: toFixed` and `404 Not Found` errors.*

4.  **Control External Processes with Fallbacks:** When controlling external processes like Puppeteer, always assume the primary method can fail and implement a robust fallback (e.g., `try connect, catch, then launch`). *Failure to do this made the pipeline unstable.*

5.  **Prioritize User Convenience:** New CLI options must be documented in `COMMANDS.md`. GUI features should be intuitive and not require the user to remember text commands. *Failure to do this created a poor user experience.*

6.  **Manage Context Window:** The context window is finite. When the conversation history becomes long, proactively summarize the progress, log it to `docs/DEVELOPMENT_LOG.md`, and clearly state the next steps to ensure context is not lost.

---

## Primary Goal

To create a robust, script-based pipeline that transforms raw web content (URLs, articles) into a series of refined, platform-specific social media posts. The entire process must be stable, repeatable, and prevent data loss or duplication.

## Current Pipeline Architecture

The workflow is a three-step, script-based process. A lightweight test mode is available via a `--test` flag for all scripts.

1.  **`scripts/pipeline/1_process_raw.js`**
    *   **Input:** `data/1_raw/urls.csv` & `sources.csv`.
    *   **Action:** Scrapes web content using a robust Puppeteer setup that copies the user's Chrome profile to avoid conflicts. It integrates specialized handlers for YouTube (transcripts), Bloomberg (paywall), and sites requiring logins (cookies).
    *   **Output:** Appends cleaned, processed content to `data/2_processed/processed_content.csv`.

2.  **`scripts/pipeline/2_generate_content.js`**
    *   **Input:** `data/2_processed/processed_content.csv` and a plan from `data/3_plans/manual_plan.csv`.
    *   **Action:** Reads a plan, synthesizes the processed content into a draft article using AI (`generators` profile), composes platform-specific versions (LinkedIn, X, etc.), and translates them (prioritizing DeepL, with a Gemini fallback).
    *   **Output:** Appends the generated drafts to `data/4_runs/all_runs.csv`.

3.  **`scripts/pipeline/3_edit_content.js`**
    *   **Input:** `data/4_runs/all_runs.csv` and a user-specified `--profile` (e.g., `professional`).
    *   **Action:** Reads the generated drafts and refines them using AI (`enhancers` profiles) to improve their quality.
    *   **Output:** Appends the edited versions to `data/5_edited/edited_runs.csv`.

## Core Technologies & Configuration

*   **Central Configuration:** `config/profiles.json` is the single source of truth for all AI model settings, default values, and prompts for every stage of the pipeline (`generators`, `enhancers`, `humanizers`).
*   **Data Integrity:** The pipeline is designed to be **append-only** to prevent data loss. Duplication is avoided by checking for existing records before processing.
*   **Testing:** A `--test` flag on all scripts enables a fast, lightweight run using `*_test.csv` files and cost-effective AI models defined in `config/profiles.json`.

