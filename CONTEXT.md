# Project-Specific Context

## Primary Goal

This project is a multi-functional content processing pipeline designed to:
1.  **Scrape** web articles from a list of URLs, employing sophisticated techniques to bypass paywalls and anti-bot measures.
2.  **Generate AI-powered summaries** of the scraped content using different LLM providers (OpenAI, Gemini) and customizable "profiles" (e.g., for an investor, researcher).
3.  **Repurpose** the content into formats suitable for social media platforms (like X/Twitter).
4.  **Evaluate and assess** the quality of the generated summaries systematically.

## Core Workflow & Scripts

The project operates through a series of distinct scripts, designed to be run in sequence:

1.  **Harvesting (`harvest.js`)**: This is the data collection step. It uses Puppeteer with stealth plugins and a real user Chrome profile to scrape articles from `urls.csv`. It is designed to be slow and careful, mimicking human behavior to avoid detection. Scraped pages are stored locally in the `archive/` directory.

2.  **Summarization (`app.js` & `sources-run.js`)**: This is the core content generation step.
    *   `app.js`: Processes the URLs, preferably using the locally archived HTML from the harvest step. It calls an LLM to generate a summary based on a specified model and profile. It also generates a Korean translation.
    *   `sources-run.js`: Works similarly, but uses manually provided content from `sources.csv` instead of scraped files.

3.  **SNS Content Composition (`sns-composer.js`)**: A module for transforming generated summaries or raw text into formats suitable for social media platforms. Currently supports generating threads for X/Twitter.

4.  **Evaluation (`evaluate-models.js` & `assessor-run.js`)**: These scripts analyze the quality of the generated summaries. They can be used to compare different models and assess the summaries against various criteria defined in `config/profiles.json`.

## Key Features & Technologies

*   **LLM Providers**: Integrates with both **OpenAI** and **Google Gemini** APIs.
*   **Advanced Scraping**: Utilizes `puppeteer-extra` with `puppeteer-extra-plugin-stealth` to evade bot detection. It can use a user's actual Chrome profile to handle logins and paywalls.
*   **Configuration-driven**: The `config/profiles.json` file is central to the project, defining summary profiles, model parameters (including pricing for cost estimation), and assessor personas.
*   **Unified Data Output**: All summarization runs are aggregated into `output/all_runs.csv`, providing a single, comprehensive dataset for analysis. Individual summaries are also saved as Markdown and JSON files.
*   **Cost Tracking**: The tool logs API usage and estimates the cost of generation tasks.
*   **Modular Scripts**: Each major function (harvesting, summarizing, evaluating) is handled by a separate script, allowing for a flexible and manageable workflow.

## Known Challenges

The web scraping component (`harvest.js`) has a significant history of dealing with advanced anti-bot solutions like **DataDome**. As detailed in `DEVELOPMENT_LOG.md`, key challenges have included:
*   **IP-based blocking**: Puppeteer was found to bypass the system's VPN, exposing the real IP address. This is the most critical factor for successful harvesting.
*   **Browser Fingerprinting**: While largely mitigated by the stealth plugin, it remains a consideration.
*   **Behavioral Analysis**: The script now includes complex, human-like interactions (mouse movements, scrolling) to counter behavioral analysis by anti-bot systems.

Any work on `harvest.js` must be done with this context in mind, prioritizing IP masking and careful, slow requests.

---
# General Context for AI Assistant

## Project Initialization Workflow

This project should begin with a structured conversation to define its goals, scope, and the strategy for implementation. Follow these steps:

1.  **User's Goal Statement**: The user will provide the primary objective or a high-level description of the project.
2.  **AI-led Scoping and Strategy Discussion**:
    *   As the AI assistant, your immediate next step is to facilitate a discussion to break down the user's high-level goal.
    *   Your primary responsibility is to ask precise, clarifying questions to resolve any ambiguity regarding the project's scope, desired features, and specific requirements. Do not proceed if the goal is not well-defined.
    *   Based on the clarified goal, propose a technical strategy, architecture, and a general workflow.
    *   Collaboratively refine this strategy with the user until there is a clear and mutually agreed-upon plan.
3.  **Create a Detailed Plan**: Once the strategy is approved, create a detailed, step-by-step plan (e.g., a TODO list) that outlines the tasks required for execution.
4.  **Begin Implementation**: With the plan in place, start working on the first task.

## Evolving This Context File

This document is not static. It is expected to be updated and refined as we develop better collaborative workflows. The process for updating it is as follows:

1.  **Propose a Change**: Either the user or the AI can propose a change to this document based on a lesson learned or a new idea for improving the process.
2.  **Discuss and Agree**: We will briefly discuss the proposed change to ensure it's beneficial.
3.  **Apply the Change**: The AI will edit this file to incorporate the agreed-upon change. This is analogous to a "pull request" in a typical software project, where changes are reviewed before being merged.

This file provides general guidelines for an AI assistant working on a coding project.

## Core Principles
1.  **Understand the Goal**: Before writing code, fully understand the user's high-level objective. Ask clarifying questions if the goal is ambiguous.
2.  **Plan Your Work**: For any non-trivial request, create a plan and share it. Use a TODO list to track progress and mark items as complete.
3.  **Be Systematic**: Make one logical change at a time. Verify each change before moving to the next. Avoid making many unrelated changes in a single step.
4.  **Explain Your Actions**: Briefly explain *why* you are taking a certain step before you do it. Provide the commands for the user to run, explaining what each one does.
5.  **Self-Correction**: If a command fails or an approach doesn't work, analyze the error, explain the cause, and propose a new solution. Don't repeat the same mistake.

## Code Quality & Style
1.  **Clean & Readable**: Write clean, well-structured, and commented code. Follow the existing coding style of the project.
2.  **Modular**: Create small, single-purpose functions and modules where appropriate. Avoid monolithic scripts.
3.  **Configuration over Hardcoding**: Use configuration files (`.json`, `.env`) for parameters that might change, such as API keys, model names, or file paths.
4.  **Error Handling**: Implement robust error handling. The application should handle failures gracefully and provide clear error messages.

## Project Management
1.  **Version Control**: Use Git for version control. Make small, atomic commits with clear messages that explain the "why" of the change.
2.  **Documentation**: Keep `README.md` and other documentation up-to-date. Any change that affects how the user runs or configures the project must be documented.
3.  **Dependency Management**: Use a package manager (`package.json`, `requirements.txt`, etc.) and keep dependencies clean. Explain why a new dependency is needed before adding it.

## Communication
1.  **Clarity and Conciseness**: Be clear and to the point. Avoid jargon where possible.
2.  **Acknowledge User Input**: Explicitly acknowledge the user's requests and feedback.
3.  **Proactive Updates**: Keep the user informed about your progress, especially for long-running tasks.

## Development History & Push Policy

- Maintain two documents at repo root:
  - `DEVLOG.md`: narrative context of sessions, decisions, and next steps.
  - `CHANGELOG.md`: semantic, versioned record of notable changes.
- Workflow:
  1. Record intent and context in `DEVLOG.md` before significant work.
  2. Make local commits frequently; push only major/stable changes or when collaboration requires it.
  3. Summarize major changes in `CHANGELOG.md` using Keep a Changelog style.
  4. Reference the relevant DEVLOG entry in commit messages when helpful.

## Project Artifacts

A new project initialized via `cinit` contains several key files. Understand their roles:

1.  **`context.md`**: The **Single Source of Truth** for the AI agent. This is your primary tool for guiding the AI. It defines the project's goal, scope, and technical constraints. It should be updated continuously as the project evolves.
2.  **`NEXT_STEPS.md`**: A **bootstrapping guide**. It contains the ideal first prompt to give the AI agent to kickstart the development process in a structured way. Its purpose is fulfilled after this first prompt.
3.  **`DEVLOG.md`**: The **project's narrative log**. Use it to record the "why" behind decisions, track experiments, and maintain context between development sessions. This is for both you and the AI to review.
4.  **`CHANGELOG.md`**: The **formal record of changes**. Use it to document notable updates, bug fixes, and new features, typically adhering to Semantic Versioning.

