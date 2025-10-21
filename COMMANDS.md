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

---
*The old scripts (`app.js`, `sources-run.js`, `generate-sns-content.js`) are now considered legacy but have been kept for reference during the transition.*
