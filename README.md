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
   echo "https://example.com/article" >> urls.txt
   ```

4. **Run the tool**:
   ```bash
   npm start
   ```

## ⚙️ Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=your_api_key_here
PROVIDER=openai            # openai | gemini

# Optional
OPENAI_MODEL=gpt-4o-mini          # Model to use
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-pro
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
```

Outputs:
- `evaluation/model_evaluation_report.md`
- `evaluation/evaluation_data.json`
- `evaluation/evaluation_results.csv`

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