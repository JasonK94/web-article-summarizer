# Project Commands

This file contains the common commands for the routine operation of this project.

## Main Workflow

### Step 1: Process Raw Inputs
This script reads from `data/1_raw`, processes the content, and creates a standardized `processed_content.csv` file.
```bash
node scripts/pipeline/1_process_raw.js
```

### Step 2: Generate Content from a Plan
This script reads a plan from `data/3_plans`, synthesizes content, and creates the final output folders.
```bash
node scripts/pipeline/2_generate_content.js
```

### Step 3: Enhance and Edit Generated Content
This script reads the drafts from `all_runs.csv`, refines them using an "editor" AI profile, and saves the polished results to a new file in `data/5_edited/`.

You can specify which editor profile to use with the `--profile` flag.
```bash
# Example using the 'professional' profile
node scripts/pipeline/3_edit_content.js --profile professional

# Example using the 'simple' profile
node scripts/pipeline/3_edit_content.js --profile simple
```
**Available Profiles:** `professional`, `simple` (defined in `config/profiles.json`)

### Step 4: Humanize Edited Content
This is the final step. It reads the edited drafts, applies a "humanizer" AI profile to make the text more natural and engaging, and saves the final results to `data/6_humanized/`.

You can specify which humanizer profile to use with the `--profile` flag.
```bash
# Example using the default 'friendly_korean_v1' profile
node scripts/pipeline/4_humanize_content.js --profile friendly_korean_v1
```
**Available Profiles:** `friendly_korean_v1` (defined in `config/profiles.json`)

---
*The old scripts (`app.js`, `sources-run.js`, `generate-sns-content.js`) are now considered legacy but have been kept for reference during the transition.*