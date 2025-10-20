# Web Article Summarizer Tool

A powerful Node.js tool that scrapes web articles (including paywalled content) and generates AI-powered summaries using customizable profiles and OpenAI models.

## ✨ Features

- 🎯 **Context Profiles**: Pre-configured summary formats for different use cases
- 🤖 **Model Selection**: Choose from GPT-4o, GPT-4o-mini, or GPT-3.5-turbo
- 🔒 **Paywall Bypass**: Uses your Chrome profile for authenticated access
- 📊 **Cost Tracking**: Real-time token usage and cost estimation
- 📁 **Clean Output**: Organized file structure with comprehensive reports
- ⚡ **Batch Processing**: Handle multiple URLs efficiently
- 🛡️ **Error Handling**: Robust error management and logging

## 🎯 Context Profiles

| Profile | Description | Best For |
|---------|-------------|----------|
| **researcher** | Detailed academic analysis | Academic research, detailed studies |
| **investor** | Market-focused analysis | Investment decisions, financial analysis |
| **executive** | Strategic overview | C-level executives, strategic planning |
| **student** | Educational summary | Learning, study materials |

## 🎯 Context & Safety

- See `CONTEXT.md` for operational guidelines: be cautious with request rates, separate harvesting from summarizing, prefer archives when available, and respect site ToS.

## Recommended Workflow

This project has multiple scripts. Follow this numbered sequence for a standard workflow.

### Step 1: Harvest (Collect Articles)

This step connects to live websites to download article HTML. It's the only step that makes live web requests, and it's designed to be slow and careful to avoid bot detection.

**➡️ Run this command (make sure Chrome is closed):**
```bash
node harvest.js
```
- **Input**: `urls.csv` or `urls.txt`.
- **Output**: `archive/pages/*.html` (article content) and `archive/archive_index.csv` (metadata index).
- **Behavior**: Launches a **visible, non-headless** Chrome browser using your actual user profile (`--user-data-dir`) to leverage existing login sessions. It uses `puppeteer-extra-plugin-stealth` to hide automation signals. To mimic human behavior, it sets a standard `1920x1080` viewport, waits random intervals between actions, moves the mouse, and scrolls multiple times. It saves the full HTML source but avoids `page.pdf()` which is a clear automation fingerprint.

### Step 2: Summarize (Generate Summaries)

This step processes local files to generate summaries. It does **not** connect to live websites if archives exist from Step 1.

#### Option 2a: Summarize from Harvested Archives
**➡️ Run this command:**
```bash
node app.js --provider openai --model gpt-4o-mini --profile investor
```
- **Input**: `archive/archive_index.csv` and `archive/pages/*.html`. If an archived version is not found for a URL, it will attempt a **live request** as a fallback.
- **Output**: Appends new summary rows to the unified `output/all_runs.csv`. Also creates a `output/last_run.json` report and individual `output/[articlename]_[model]_[profile].md` files for the last run.
- **Behavior**: Reads URLs, checks for existing summaries in `all_runs.csv` (and skips if `--duplicate false`), then loads article content (preferring local archives). It then calls the specified LLM provider (OpenAI/Gemini) to generate the English summary, followed by a call to a cost-effective Gemini model to translate it into Korean. All results are saved to the unified CSV.

#### Option 2b: Summarize from Manual Sources
Use this if you prefer to copy-paste article content yourself.

**➡️ Prepare `sources.csv` then run:**
```bash
node sources-run.js
```
- **Input**: `sources.csv` (schema: `id,title,url,type,content`).
- **Output**: Appends new summary rows to `output/all_runs.csv`. Also creates individual `output/[articlename]_[id]_[model]_[profile].manual.md` files.
- **Behavior**: Parses the `sources.csv` file. If `type=html`, it extracts the main article text using `cheerio`. It then calls the specified LLM provider to generate English and Korean summaries, and appends all results to the central `all_runs.csv`, making them available for the assessment step.

### Step 3: Analyze and Assess (Evaluate Quality)

These scripts use the generated summaries in `all_runs.csv` to perform analysis.

**➡️ Run these commands in order:**
```bash
node evaluate-models.js
node assessor-run.js
```
- **Input**: `output/all_runs.csv` and `config/profiles.json` (for assessor profiles).
- **Output**: Creates detailed reports in the `evaluation/` directory, such as `assessment_results.csv`.

### Step 4: Enhance (Improve Summaries)

This is an optional but powerful step to iteratively improve the quality of your summaries using an LLM as an editor.

**➡️ Run this command:**
```bash
node summary-enhancer.js --enhancer professional --model gpt-4o
```
- **Input**: `output/all_runs.csv`.
- **Output**: Updates `output/all_runs.csv` in-place by adding a new column (e.g., `enhanced_professional_summary`) with the revised summaries.
- **Behavior**: Reads each summary from `all_runs.csv`, sends it to an LLM with a specific "enhancement" prompt (defined in `config/profiles.json`), and saves the result. This allows you to, for example, make all summaries conform to a specific professional tone or simplify them for a broader audience.
- **CLI Options**:
  - `--enhancer <profile>`: **Required**. The enhancement profile to use (e.g., `professional`, `simple`).
  - `--provider <openai|gemini>`: Provider to use for the enhancer model.
  - `--model <model_name>`: Specific model to use for enhancement (e.g., `gpt-4o`).

### Evaluators & Assessors

This project contains two scripts for analysis: `evaluate-models.js` and `assessor-run.js`.

**`evaluate-models.js` (Model-centric evaluation)**
- **Purpose**: To quickly test different models against a sample of your URLs to check for API compatibility, errors, and basic performance metrics (like token count and cost). It does **not** perform deep quality analysis.
- **Behavior**: It makes **live calls** to LLM APIs (OpenAI/Gemini) using a placeholder prompt with sample content. It does **not** use the content from your `urls.csv` or archives, as its primary goal is to verify API credentials and model availability, not content quality.
- **Output**: Creates `evaluation/model_evaluation_report.md` and `evaluation_results.csv` with high-level stats like token counts and costs.
- **CLI Options**:
  - `--models <model1> <model2> ...`: Specify models to test (from `config/profiles.json`).

**`assessor-run.js` (Quality-centric assessment)**
- **Purpose**: To perform a deep, qualitative assessment of summaries that you have already generated and stored in `output/all_runs.csv`.
- **Behavior**: Reads every summary from `output/all_runs.csv`. For each summary, it makes a **single, combined API call** to the assessor LLM to get scores and feedback for all assessors at once. This is efficient and avoids making separate calls for each assessor.
- **Output**: Creates a single, easy-to-read `evaluation/assessment_results.csv` in a "Wide Format". Each row represents one summary, with columns for each assessor's scores and written feedback, plus an overall average score.
- **CLI Options**:
  - `--provider <openai|gemini>`: Which provider to use for the assessor model.
  - `--assessorModel <model_name>`: Specify which model to use for performing the assessments (e.g., `gpt-4o`). If not provided, it uses the default model from your `.env`.
  - `--assessors <p1> <p2> ...`: Specify which assessor profiles to use (from `config/profiles.json`).

### Maintenance

**➡️ Run this command as needed:**
```bash
node update-models.js
```
- **Input**: `config/profiles.json`
- **Output**: `output/api_models_table.csv`
- **Behavior**: Regenerates the model pricing/information table based on the current configuration.


## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp env.example .env
   # Edit .env with your OpenAI API key
   ```

3. **Add URLs**:
   ```bash
   echo "id,url" > urls.csv
   echo "1,https://example.com/article" >> urls.csv
   ```

4. **Run the Workflow**:
   Follow the **Recommended Workflow** steps above.

## ⚙️ Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=your_api_key_here
PROVIDER=openai            # openai | gemini

# Optional
OPENAI_MODEL=gpt-4o-mini          # Model to use
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-pro
SUMMARY_PROFILE=investor          # Profile: researcher, investor, executive, student
OUTPUT_FORMAT=markdown           # Output: markdown or csv
USE_TEMP_PROFILE=true           # Use temporary Chrome profile
```

### Available Models

| Model | Cost/1k tokens | Best For | Max Tokens |
|-------|----------------|----------|------------|
| **gpt-4o** | $0.03 | Complex analysis | 4096 |
| **gpt-4o-mini** | $0.0015 | Balanced performance | 4096 |
| **gpt-3.5-turbo** | $0.0005 | Cost-effective | 4096 |

## 📁 Project Structure

```
web-article-summarizer/
├── app.js                 # Main application
├── config/
│   └── profiles.json      # Context profiles and model configs
├── output/               # Generated summaries
├── urls.txt             # Input URLs
├── .env                 # Environment configuration
└── README.md           # This file
```

## 🎨 Output Examples

### Investment Brief Profile
```markdown
# Market Impact
- Antidepressants market expanding beyond clinical use
- New $3.2B lifestyle enhancement segment emerging

# Financial Implications
- 25% increase in off-label prescriptions
- Potential regulatory risks for pharmaceutical companies
```

### Executive Summary Profile
```markdown
# Strategic Overview
- Market trend: Antidepressants as lifestyle accessories
- Competitive landscape: New market segment emerging

# Decision Points
- Regulatory compliance considerations
- Market positioning opportunities
```

## 🔧 Advanced Usage

### Custom Profiles
Edit `config/profiles.json` to create custom summary formats:

```json
{
  "profiles": {
    "custom": {
      "name": "Custom Analysis",
      "system_prompt": "Your custom instructions...",
      "format": {
        "sections": ["Section 1", "Section 2"]
      }
    }
  }
}
```

### Batch Processing
```bash
# Process multiple URLs
echo "https://site1.com/article1" >> urls.txt
echo "https://site2.com/article2" >> urls.txt
npm start
```

### CLI Options

You can run the tool with command-line overrides:

```bash
node app.js \
  --provider openai \
  --model gpt-4o-mini gpt-3.5-turbo \
  --profile investor researcher \
  --article 1 2 3 \
  --duplicate false
```

- `--provider`: `openai` or `gemini`
- `--model`: one or multiple models. Use `all` to run all configured.
- `--profile`: one or multiple profiles. Use `all` to run all configured.
- `--article`: list of article indices from `urls.csv`/`urls.txt`. If `--model` or `--profile` is `all`, default to a single article to save tokens.
- `--duplicate`: when false (default), skip if the same article+model+profile result already exists (based on hash key).

### URLs Input

Support `urls.txt` (one URL per line) or `urls.csv` with header `id,url`:

```csv
id,url
1,https://example.com/a
2,https://example.com/b
```

The script de-duplicates URLs before processing and can skip already-summarized combinations by hash.

### Evaluators

Evaluator profiles are defined in `config/profiles.json` under `assessors`. Run the evaluator tool:

```bash
node evaluate-models.js
node assessor-run.js
```

Outputs:
- `evaluation/model_evaluation_report.md`
- `evaluation/evaluation_data.json`
- `evaluation/evaluation_results.csv`
- `evaluation/assessment_results.csv`

### Models table updates

Regenerate the models pricing table from `config/profiles.json`:

```bash
node update-models.js
```

## 🛠️ Troubleshooting

- **Paywall issues**: Set `USE_TEMP_PROFILE=false` and close Chrome first
- **API errors**: Check your OpenAI API key and billing
- **Content extraction**: Some sites may need custom selectors
- **Chrome path**: Update `CHROME_USER_DATA` for your system

## 📊 Cost Estimation

The tool provides real-time cost tracking:
- Token usage per article
- Total cost for batch processing
- Cost per profile/model combination

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Made with ❤️ for efficient content analysis**