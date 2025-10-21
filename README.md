# Web Article Summarizer & SNS Content Generator

A powerful Node.js tool that scrapes web articles, generates AI-powered summaries, and repurposes them into ready-to-post content for various social media platforms.

## ✨ Features

- 🎯 **Customizable Profiles**: Generate summaries tailored for different audiences (e.g., investors, researchers).
- 🤖 **Multi-Provider Support**: Works with both OpenAI and Google Gemini models.
- 🔒 **Paywall Bypass**: Leverages your own Chrome profile to access subscription-based content.
- 📊 **Cost & API Logging**: Tracks token usage and costs for each API call.
- 📁 **Organized & Versioned Output**: Automatically versions outputs to prevent overwriting during development.
- 🌐 **Korean Translation**: Includes a built-in translation step for generated summaries.
- ✍️ **SNS Content Generation**: Transforms summaries into posts for X, Threads, LinkedIn, and Facebook.

## 🚀 New, Streamlined Workflow

The project has been refactored to focus on a clear, end-to-end content generation pipeline. The previous steps involving model evaluation and automated assessment have been deprecated in favor of manual review of the final output.

```mermaid
graph TD
    subgraph "1. Input"
        A["urls.csv / urls.txt"]
        B["sources.csv (Manual Pasted Content)"]
    end

    subgraph "2. Summarization"
        C["`scripts/harvest.js` (Optional, for difficult sites)"]
        D["`scripts/app.js` (for URLs)"]
        E["`scripts/sources-run.js` (for manual sources)"]
    end

    subgraph "3. AI-Generated Summaries"
        F["Summaries created in<br/>`/output` folder (.md, .json)"]
    end

    subgraph "4. SNS Content Generation"
        G["`scripts/generate-sns-content.js`"]
    end

    subgraph "5. Final Output & Review"
        H["Platform-specific posts in<br/>`/output/sns-posts`"]
        I["Manual Review & Posting"]
    end

    A --> C;
    C --> D;
    A --> D;
    B --> E;
    D --> F;
    E --> F;
    F --> G;
    G --> H;
    H --> I;
```

### Step 1: Prepare Raw Inputs

-   **For URLs**: Add URLs to `data/1_raw/urls.csv` (with an `id,url` header).
-   **For Manual Content**: Add your content directly into `data/1_raw/sources.csv`.

### Step 2: Process Raw Content into a Standardized Format
This step reads from `data/1_raw`, scrapes content, adds metadata, and creates a single, clean `processed_content.csv` file.

**➡️ Run this command:**
```bash
node scripts/pipeline/1_process_raw.js
```

### Step 3: Define a Generation Plan
Edit a plan file in `data/3_plans/` (e.g., `manual_plan.csv`) to specify which processed items to combine into a new piece of content.
```csv
processed_ids,subject,model,profile
1,2,"A synthesized article about AI and science funding",gpt-4o,investor
```

### Step 4: Generate Final Content
This step executes your plan, generates the content, and creates the final output.

**➡️ Run this command:**
```bash
node scripts/pipeline/2_generate_content.js
```
- **Output**: Creates a new, versioned folder in `output/` and updates the master log at `data/4_runs/all_runs.csv`.

## 📁 Project Structure

The project follows a more organized file structure after the refactor.

```
/
├── scripts/              # All executable .js scripts
│   ├── app.js
│   ├── harvest.js
│   ├── generate-sns-content.js
│   └── ...
├── docs/                 # Documentation files (CHANGELOG, DEVLOG, etc.)
├── config/
│   └── profiles.json     # AI prompts, model configs, etc.
├── input/                # Input files (urls.csv, sources.csv)
├── output/               # All generated output
│   ├── sns-posts/        # Sub-folder for generated SNS posts
│   └── ...               # Summaries (.md, .json)
├── logs/                 # Log files (api_usage.csv, app.log, error.log)
├── .env                  # Environment configuration
└── README.md             # This file
```

## 🚀 Quick Start

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configure environment**:
    - Copy `env.example` to `.env` (`cp env.example .env`).
    - Edit `.env` to add your `OPENAI_API_KEY` and/or `GEMINI_API_KEY`.
    - **Crucially**, update `CHROME_USER_DATA` to point to your local Chrome profile path. This is required for bypassing paywalls.

3.  **Add URLs**:
    - Edit `data/1_raw/urls.csv` and add one or more article URLs.

4.  **Define a Plan**:
    - Edit `data/3_plans/manual_plan.csv` to reference the `id` of the URL you just added.

5.  **Run the Workflow**:
    ```bash
    # 1. Process your raw URL into standardized content
    node scripts/pipeline/1_process_raw.js

    # 2. Execute your plan to generate the final SNS posts
    node scripts/pipeline/2_generate_content.js
    ```

## ⚙️ Configuration

Your `.env` file is the primary place for configuration.

```bash
# Required
OPENAI_API_KEY=your_api_key_here
CHROME_USER_DATA="C:/Users/YourUser/AppData/Local/Google/Chrome/User Data"

# Optional
PROVIDER=gemini                  # Default provider: openai | gemini
OPENAI_MODEL=gpt-5         # Default OpenAI model
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
SUMMARY_PROFILE=investor         # Default summary profile
```

For more advanced configuration, such as defining new summary profiles or prompts, edit `config/profiles.json`.

## 🔧 Troubleshooting

-   **Paywall Issues**: Ensure `CHROME_USER_DATA` in your `.env` is correct and that you have closed all Chrome windows before running `harvest.js` or `app.js`.
-   **API Errors**: Double-check your API keys in `.env`. Check your provider's dashboard for any billing issues.
-   **Content Extraction Errors**: Some websites may have structures that the scraper can't handle. The `harvest.js` script is the best workaround.
-   **Unhandled Errors**: All critical errors are now logged to `logs/error.log`.

---

**Made with ❤️ for efficient content analysis**