import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import Papa from 'papaparse';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logApiUsage } from '../logger.js';

// --- Configuration ---
const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_DIR = path.join(DATA_DIR, '4_runs');
const EDITED_DIR = path.join(DATA_DIR, '5_edited');
const CONFIG_PATH = path.join(process.cwd(), 'config', 'profiles.json');

const isTestMode = process.argv.includes('--test');

const RUNS_FILE_PATH = path.join(RUNS_DIR, isTestMode ? 'all_runs_test.csv' : 'all_runs.csv');
const EDITED_FILE_PATH = path.join(EDITED_DIR, isTestMode ? 'edited_runs_test.csv' : 'edited_runs.csv');

// --- Argument Parsing for Profile ---
let editorProfileKey = 'professional'; // Default profile
const profileArgIndex = process.argv.findIndex(arg => arg === '--profile');
if (profileArgIndex !== -1 && process.argv[profileArgIndex + 1]) {
    editorProfileKey = process.argv[profileArgIndex + 1];
}
// --- End Argument Parsing ---

// --- Load Configuration ---
let config;
try {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
} catch (error) {
    console.error(`❌ Failed to load or parse config/profiles.json: ${error.message}`);
    process.exit(1);
}

const defaults = isTestMode ? config.test_defaults : config.defaults;
let EDITOR_MODEL_KEY = defaults.editor_model;
let EDITOR_PROVIDER = defaults.provider;

// --- AI Client Initialization ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let openai, genai;
if (OPENAI_API_KEY) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
if (GEMINI_API_KEY) genai = new GoogleGenerativeAI(GEMINI_API_KEY);

if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
    console.error("❌ Neither OPENAI_API_KEY nor GEMINI_API_KEY is set in .env file. Please provide at least one.");
    process.exit(1);
}

/**
 * Edits a given text using a specified Gemini model and profile.
 * @param {string} textToEdit - The text content to be edited.
 * @param {object} profile - The editor profile containing the system prompt.
 * @param {object} modelsConfig - Configuration for AI models.
 * @returns {Promise<string>} - The edited text.
 */
async function editContent(textToEdit, profile, modelsConfig, platform, lang) {
  if ((!genai && EDITOR_PROVIDER === 'gemini') || (!openai && EDITOR_PROVIDER === 'openai') || !textToEdit) {
    return textToEdit; // Return original if AI is not configured or text is empty
  }

  console.log(`  - Editing for ${platform} (${lang}) with ${EDITOR_PROVIDER}/${EDITOR_MODEL_KEY} using profile '${editorProfileKey}'`);
  
  const systemPrompt = profile.system_prompt;
  let userPrompt = `Please enhance the following text according to your instructions. **Crucially, you must respond in the same language as the input text.**\n\n--- TEXT ---\n${textToEdit}`;

  if (isTestMode) {
    userPrompt += "\n\n**IMPORTANT: For this test run, please keep your response extremely short (under 20 words).**";
  }

  let editedText = '';
  let tokensUsed = 0;

  const executeEdit = async (provider, modelKey) => {
    if (provider === 'gemini') {
        const model = genai.getGenerativeModel({ model: modelKey });
        const result = await model.generateContent([systemPrompt, userPrompt]);
        editedText = result.response.text();
        tokensUsed = Math.round((systemPrompt.length + userPrompt.length + editedText.length) / 4);
    } else if (provider === 'openai') {
        const response = await openai.chat.completions.create({
            model: modelKey,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          });
        editedText = response.choices[0].message.content;
        tokensUsed = response.usage?.total_tokens || 0;
    }
  }

  try {
    await executeEdit(EDITOR_PROVIDER, EDITOR_MODEL_KEY);
  } catch (e) {
    console.error(`    ❌ AI editing with ${EDITOR_PROVIDER} failed: ${e.message}`);
    if (EDITOR_PROVIDER === 'gemini' && openai) {
        console.log('      -> Falling back to OpenAI...');
        try {
            EDITOR_PROVIDER = 'openai';
            EDITOR_MODEL_KEY = 'gpt-4o-mini'; 
            await executeEdit(EDITOR_PROVIDER, EDITOR_MODEL_KEY);
        } catch (fallbackError) {
            console.error(`    ❌ Fallback AI editing failed: ${fallbackError.message}`);
            return `EDITING_FAILED: ${fallbackError.message}`;
        }
    } else {
        return `EDITING_FAILED: ${e.message}`;
    }
  }

  // Log API usage
  const cost = (tokensUsed / 1000) * (modelsConfig[EDITOR_MODEL_KEY]?.cost_per_1k_tokens || 0);
  await logApiUsage({ provider: EDITOR_PROVIDER, model: EDITOR_MODEL_KEY, tokensUsed, cost, function: `edit_${editorProfileKey}` });

  return editedText;
}

/**
 * Main function to process the all_runs.csv file and apply edits.
 */
async function main() {
  if (isTestMode) {
    console.log("🧪 RUNNING IN TEST MODE 🧪");
  }

  console.log(`🚀 Starting content editing process with profile: '${editorProfileKey}'...`);

  if (!genai && !openai) {
    console.log("🚫 No AI client initialized. Exiting.");
    return;
  }

  // --- Load Data ---
  let allRuns = [];
  try {
      const runsCsv = await fs.readFile(RUNS_FILE_PATH, 'utf-8');
      const parseResult = Papa.parse(runsCsv, {
          header: true,
          skipEmptyLines: true,
          bom: true
      });
      allRuns = parseResult.data;

      if (parseResult.errors.length > 0) {
          console.warn("⚠️  Warnings encountered during CSV parsing:");
          parseResult.errors.forEach(err => console.warn(`   - ${err.message}`));
      }

  } catch(e) {
      if (e.code === 'ENOENT') {
          console.error(`❌ Source file not found: ${RUNS_FILE_PATH}. Run Step 2 first.`);
          return;
      }
      throw e;
  }
  
  // Ensure the output directory exists
  await fs.mkdir(EDITED_DIR, { recursive: true });
  
  // Load existing edited runs to avoid re-processing
  const editedRunsMap = new Map();
  try {
      const editedCsv = await fs.readFile(EDITED_FILE_PATH, 'utf-8');
      const edits = csvParse(editedCsv, { columns: true, bom: true });
      edits.forEach(run => editedRunsMap.set(`${run.run_id}-${run.editor_profile}`, run));
  } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      console.log('No existing edited runs file found. A new one will be created.');
  }
  
  // --- Ensure CSV header exists if the file is new ---
  if (editedRunsMap.size === 0) {
      const headers = [
          'run_id', 'editor_profile',
          'linkedin_edited_en', 'linkedin_edited_kor', 'x_edited_en', 'x_edited_kor',
          'facebook_edited_en', 'facebook_edited_kor', 'threads_edited_en', 'threads_edited_kor'
      ].join(',');
      await fs.writeFile(EDITED_FILE_PATH, '\ufeff' + headers + '\n', 'utf-8');
  }

  const editorProfile = config.enhancers[editorProfileKey];
  const modelsConfig = config.models;

  if (!editorProfile) {
    console.error(`❌ Editor profile '${editorProfileKey}' not found in config.json's enhancers section. Exiting.`);
    return;
  }
  
  let newEditsCount = 0;
  const platforms = ['linkedin', 'x', 'facebook', 'threads'];

  for (const run of allRuns) {
    const runId = run.run_id;
    const mapKey = `${runId}-${editorProfileKey}`;
    
    // Skip if this run has already been edited with this profile
    if (editedRunsMap.has(mapKey)) {
        console.log(`⏩ Skipping Run ID ${runId} as it has already been edited with profile '${editorProfileKey}'.`);
        continue;
    }
    
    console.log(`✍️  Processing Run ID: ${runId}`);
    
    const newEditedRun = {
        run_id: runId,
        editor_profile: editorProfileKey,
    };
    
    let hasContentToEdit = false;
    for (const lang of ['en', 'kor']) {
      for (const platform of platforms) {
        const sourceCol = `${platform}_${lang}`;
        const targetCol = `${platform}_edited_${lang}`;

        if (run[sourceCol]) {
          const originalText = run[sourceCol];
          const editedText = await editContent(originalText, editorProfile, modelsConfig, platform, lang);
          newEditedRun[targetCol] = editedText;
          hasContentToEdit = true;
        }
      }
    }
    
    if (hasContentToEdit) {
        const csvString = csvStringify([newEditedRun], { header: false, quoted: true });
        await fs.appendFile(EDITED_FILE_PATH, csvString, "utf-8");
        newEditsCount++;
    }
  }

  if (newEditsCount > 0) {
    console.log(`✅ Editing complete. ${newEditsCount} new edits were appended to ${EDITED_FILE_PATH}`);
  } else {
    console.log("✅ No new content required editing.");
  }
}

main().catch(console.error);
