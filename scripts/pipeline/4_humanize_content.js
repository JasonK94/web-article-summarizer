import 'dotenv/config';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logApiUsage } from '../logger.js';

// --- Configuration ---
const DATA_DIR = path.join(process.cwd(), 'data');
const EDITED_DIR = path.join(DATA_DIR, '5_edited');
const HUMANIZED_DIR = path.join(DATA_DIR, '6_humanized');
const CONFIG_PATH = path.join(process.cwd(), 'config', 'profiles.json');

const isTestMode = process.argv.includes('--test');

const EDITED_FILE_PATH = path.join(EDITED_DIR, isTestMode ? 'edited_runs_test.csv' : 'edited_runs.csv');
const HUMANIZED_FILE_PATH = path.join(HUMANIZED_DIR, isTestMode ? 'humanized_runs_test.csv' : 'humanized_runs.csv');

// --- Argument Parsing for Profile ---
let humanizerProfileKey = 'friendly_korean_v1'; // Default profile
const profileArgIndex = process.argv.findIndex(arg => arg === '--profile');
if (profileArgIndex !== -1 && process.argv[profileArgIndex + 1]) {
    humanizerProfileKey = process.argv[profileArgIndex + 1];
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
let HUMANIZER_MODEL_KEY = defaults.humanizer_model;
let HUMANIZER_PROVIDER = defaults.provider;

// --- AI Client Initialization ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let openai, genai;
if(OPENAI_API_KEY) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
if (GEMINI_API_KEY) genai = new GoogleGenerativeAI(GEMINI_API_KEY);

if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
    console.error("❌ Neither OPENAI_API_KEY nor GEMINI_API_KEY is set in .env file. Please provide at least one.");
    process.exit(1);
}

async function humanizeContent(textToHumanize, profile, platform, lang) {
    if (isTestMode) {
        return `[TEST] Humanized content for ${platform} (${lang}).`;
    }
    if ((!genai && HUMANIZER_PROVIDER === 'gemini') || (!openai && HUMANIZER_PROVIDER === 'openai') || !textToHumanize) {
        return textToHumanize;
    }

    console.log(`  - Humanizing for ${platform} (${lang}) with ${HUMANIZER_PROVIDER}/${HUMANIZER_MODEL_KEY} using profile '${humanizerProfileKey}'`);
    
    const systemPrompt = profile.system_prompt;
    let userPrompt = `Please rewrite the following text:\n\n--- TEXT ---\n${textToHumanize}`;
    let humanizedText = '';

    const executeHumanize = async (provider, modelKey) => {
        if (provider === 'gemini') {
            const model = genai.getGenerativeModel({ model: modelKey });
            const result = await model.generateContent([systemPrompt, userPrompt]);
            humanizedText = result.response.text();
        } else if (provider === 'openai') {
            const response = await openai.chat.completions.create({
                model: modelKey,
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            });
            humanizedText = response.choices[0].message.content;
        }
    }

    try {
        await executeHumanize(HUMANIZER_PROVIDER, HUMANIZER_MODEL_KEY);
        await logApiUsage({ provider: HUMANIZER_PROVIDER, model: HUMANIZER_MODEL_KEY, function: `humanize_${humanizerProfileKey}` });
        return humanizedText;
    } catch (e) {
        console.error(`    ❌ AI humanization with ${HUMANIZER_PROVIDER} failed: ${e.message}`);
        if(HUMANIZER_PROVIDER === 'gemini' && openai) {
            console.log('      -> Falling back to OpenAI...');
            try {
                HUMANIZER_PROVIDER = 'openai';
                HUMANIZER_MODEL_KEY = 'gpt-4o-mini';
                await executeHumanize(HUMANIZER_PROVIDER, HUMANIZER_MODEL_KEY);
                await logApiUsage({ provider: HUMANIZER_PROVIDER, model: HUMANIZER_MODEL_KEY, function: `humanize_${humanizerProfileKey}` });
                return humanizedText;
            } catch (fallbackError) {
                console.error(`    ❌ Fallback AI humanization failed: ${fallbackError.message}`);
                return `HUMANIZATION_FAILED: ${fallbackError.message}`;
            }
        }
        return `HUMANIZATION_FAILED: ${e.message}`;
    }
}

async function main() {
    if (isTestMode) console.log("🧪 RUNNING IN TEST MODE 🧪");
    console.log(`🚀 Starting content humanization with profile: '${humanizerProfileKey}'...`);

    // --- Load Data ---
    let editedRuns = [];
    try {
        const editedCsv = await fs.readFile(EDITED_FILE_PATH, 'utf-8');
        editedRuns = csvParse(editedCsv, { columns: true, bom: true });
    } catch(e) {
        if (e.code === 'ENOENT') {
            console.error(`❌ Source file not found: ${EDITED_FILE_PATH}. Run Step 3 first.`);
            return;
        }
        throw e;
    }
  
    await fs.mkdir(HUMANIZED_DIR, { recursive: true });
  
    const humanizedRunsMap = new Map();
    if (existsSync(HUMANIZED_FILE_PATH)) {
        const humanizedCsv = await fs.readFile(HUMANIZED_FILE_PATH, 'utf-8');
        const humanized = csvParse(humanizedCsv, { columns: true, bom: true });
        humanized.forEach(run => humanizedRunsMap.set(`${run.run_id}-${run.editor_profile}-${run.humanizer_profile}`, run));
    } else {
        const headers = ['run_id', 'editor_profile', 'humanizer_profile', 'platform', 'language', 'humanized_content'].join(',');
        await fs.writeFile(HUMANIZED_FILE_PATH, '\ufeff' + headers + '\n', 'utf-8');
    }

    const humanizerProfile = config.humanizers[humanizerProfileKey];
    if (!humanizerProfile) {
        console.error(`❌ Humanizer profile '${humanizerProfileKey}' not found in config.json. Exiting.`);
        return;
    }
  
    let newHumanizationsCount = 0;
    for (const run of editedRuns) {
        const platforms = ['linkedin', 'x', 'facebook', 'threads'];
        for (const lang of ['en', 'kor']) {
            for (const platform of platforms) {
                const mapKey = `${run.run_id}-${run.editor_profile}-${humanizerProfileKey}-${platform}-${lang}`;
                if (humanizedRunsMap.has(mapKey.substring(0, mapKey.lastIndexOf('-')))) continue;

                const sourceCol = `${platform}_edited_${lang}`;
                if (run[sourceCol] && !run[sourceCol].startsWith('EDITING_FAILED')) {
                    const humanizedContent = await humanizeContent(run[sourceCol], humanizerProfile, platform, lang);
                    
                    const newHumanizedRun = {
                        run_id: run.run_id,
                        editor_profile: run.editor_profile,
                        humanizer_profile: humanizerProfileKey,
                        platform: platform,
                        language: lang,
                        humanized_content: humanizedContent
                    };

                    const csvString = csvStringify([newHumanizedRun], { header: false, quoted: true });
                    await fs.appendFile(HUMANIZED_FILE_PATH, csvString, "utf-8");
                    newHumanizationsCount++;
                }
            }
        }
    }

    if (newHumanizationsCount > 0) {
        console.log(`✅ Humanization complete. ${newHumanizationsCount} new versions were appended to ${HUMANIZED_FILE_PATH}`);
    } else {
        console.log("✅ No new content required humanization.");
    }
}

main().catch(console.error);
