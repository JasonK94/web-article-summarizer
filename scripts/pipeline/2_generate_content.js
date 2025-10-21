import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import Papa from 'papaparse';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logApiUsage, setupGlobalErrorHandling } from '../logger.js';
import { composeForSns } from '../sns-composer.js';
import pkg from 'deepl-node';
const { Translator } = pkg;

setupGlobalErrorHandling();

// --- Configuration ---
const isTestMode = process.argv.includes('--test');
const DATA_DIR = path.join(process.cwd(), 'data');
const PROCESSED_FILE_PATH = path.join(DATA_DIR, '2_processed', isTestMode ? 'processed_content_test.csv' : 'processed_content.csv');
const PLAN_FILE_PATH = path.join(DATA_DIR, '3_plans', isTestMode ? 'manual_plan_test.csv' : 'manual_plan.csv');
const RUNS_FILE_PATH = path.join(DATA_DIR, '4_runs', isTestMode ? 'all_runs_test.csv' : 'all_runs.csv');
const CONFIG_PATH = path.join(process.cwd(), 'config', 'profiles.json');

let config, defaults, generators, models;
let DEFAULT_PROVIDER, DEFAULT_GENERATOR_MODEL, TRANSLATOR_MODEL_KEY;

// --- AI Client Initialization ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

let openai, genai, translator;
if (OPENAI_API_KEY) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
if (GEMINI_API_KEY) genai = new GoogleGenerativeAI(GEMINI_API_KEY);
if (DEEPL_API_KEY) translator = new Translator(DEEPL_API_KEY);

async function loadConfig() {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
    defaults = isTestMode ? config.test_defaults : config.defaults;
    generators = config.generators;
    models = config.models;
    DEFAULT_PROVIDER = defaults.provider;
    DEFAULT_GENERATOR_MODEL = defaults.generator_model;
    TRANSLATOR_MODEL_KEY = defaults.translator_model;
}

async function synthesizeContent(task, content) {
  const provider = task.provider || DEFAULT_PROVIDER;
  let modelKey = task.model || DEFAULT_GENERATOR_MODEL;
  
  const profileKey = task.profile || Object.keys(generators)[0];
  const profile = generators[profileKey];
  if (!profile) throw new Error(`Generator profile '${profileKey}' not found in config.`);

  console.log(`  - Synthesizing with ${provider}/${modelKey} using profile '${profileKey}'`);

  const systemPrompt = profile.system_prompt;
  let userPrompt = `Synthesize the following articles into a new piece of content with the subject: "${task.subject}".\n\n--- ARTICLES ---\n${content}`;
  if (isTestMode) {
    userPrompt += "\n\n**IMPORTANT: For this test run, please keep your response extremely short (under 20 words).**";
  }

  let synthesizedText = "";
  let tokensUsed = 0;

  try {
    if (provider === "openai") {
      if (!openai) throw new Error("OPENAI_API_KEY is not set in .env");
      const response = await openai.chat.completions.create({
        model: modelKey,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      });
      synthesizedText = response.choices[0].message.content;
      tokensUsed = response.usage?.total_tokens || 0;
    } else if (provider === "gemini") {
      if (!genai) throw new Error("GEMINI_API_KEY is not set in .env");
      const model = genai.getGenerativeModel({ model: modelKey });
      const result = await model.generateContent([systemPrompt, userPrompt]);
      synthesizedText = result.response.text();
      tokensUsed = Math.round((systemPrompt.length + userPrompt.length + synthesizedText.length) / 4);
    }
  } catch(e) {
      console.error(`    ❌ AI synthesis failed: ${e.message}`);
      return `SYNTHESIS_FAILED: ${e.message}`;
  }

  const cost = (tokensUsed / 1000) * (models[modelKey]?.cost_per_1k_tokens || 0);
  await logApiUsage({ provider, model: modelKey, tokensUsed, cost, function: `synthesize_${profileKey}` });
  
  return synthesizedText;
}

async function translateText(text, platform) {
  if (!text || text.startsWith("SYNTHESIS_FAILED:")) return text;

  if (translator) {
      try {
          console.log(`  - Translating for ${platform} with DeepL...`);
          const result = await translator.translateText(text, 'en', 'ko');
          await logApiUsage({ provider: "deepl", model: "deepl-api", function: "translate", characters: text.length });
          return result.text;
      } catch(e) {
          console.error(`    ❌ DeepL translation failed: ${e.message}. Falling back to Gemini.`);
      }
  }

  if (genai) {
    try {
      console.log(`  - Translating for ${platform} with Gemini (fallback)...`);
      const model = genai.getGenerativeModel({ model: TRANSLATOR_MODEL_KEY });
      const prompt = `Translate the following English text to Korean. Only return the translated text.\n\n${text}`;
      const result = await model.generateContent(prompt);
      const translated = result.response.text();
      const tokensUsed = Math.round((prompt.length + translated.length) / 4);
      const cost = (tokensUsed / 1000) * (models[TRANSLATOR_MODEL_KEY]?.cost_per_1k_tokens || 0);
      await logApiUsage({ provider: "gemini", model: TRANSLATOR_MODEL_KEY, tokensUsed, cost, function: "translate_fallback" });
      return translated;
    } catch (e) {
      console.error(`    ❌ Gemini translation failed: ${e.message}`);
      return `TRANSLATION_FAILED: ${e.message}`;
    }
  }
  return "Translation skipped: No API key set.";
}

async function main() {
    if (isTestMode) console.log("🧪 RUNNING IN TEST MODE 🧪");
    await loadConfig();

    let processedContent = [];
    let manualPlan = [];
    try {
        const processedContentCsv = await fs.readFile(PROCESSED_FILE_PATH, "utf-8");
        processedContent = csvParse(processedContentCsv, { columns: true, bom: true });

        const manualPlanCsv = await fs.readFile(PLAN_FILE_PATH, "utf-8");
        manualPlan = csvParse(manualPlanCsv, { columns: true, bom: true });
    } catch (e) {
        if (e.code === 'ENOENT') {
            console.error(`❌ Source file not found: ${e.message}`);
            process.exit(1);
        }
        console.error(`Error reading or parsing CSV files: ${e.message}`);
        throw e;
    }
    const contentMap = new Map(processedContent.map(item => [item.processed_id, item]));

    const runsMap = new Map();
    let nextRunId = 1;
    try {
        await fs.access(RUNS_FILE_PATH);
        const runsCsv = await fs.readFile(RUNS_FILE_PATH, 'utf-8');
        const runs = csvParse(runsCsv, { columns: true, bom: true });
        if (runs.length > 0) {
            runs.forEach(run => runsMap.set(run.plan_hash, run));
            nextRunId = Math.max(...runs.map(r => parseInt(r.run_id, 10))) + 1;
        }
    } catch (e) {
        console.log('No existing runs file found. A new one will be created.');
        const headers = ['run_id', 'plan_hash', 'processed_ids', 'subject', 'profile', 'synthesis_en', 'synthesis_kor', 'linkedin_en', 'linkedin_kor', 'x_en', 'x_kor', 'facebook_en', 'facebook_kor', 'threads_en', 'threads_kor'].join(',');
        await fs.writeFile(RUNS_FILE_PATH, '\ufeff' + headers + '\n', 'utf-8');
    }

    for (const task of manualPlan) {
        const processedIds = task.processed_ids.split(',').map(id => id.trim());
        const combinedContent = processedIds.map(id => contentMap.get(id)?.content || `[Content for ID ${id} not found]`).join('\n\n---\n\n');
        
        const planHash = `${task.processed_ids}-${task.subject}-${task.profile || 'default'}`;
        if (runsMap.has(planHash)) {
            console.log(`⏭️  Skipping already processed plan: "${task.subject}"`);
            continue;
        }
        
        console.log(`✍️  Generating content for subject: "${task.subject}"`);
        const synthesizedEn = await synthesizeContent(task, combinedContent);
        const synthesizedKor = await translateText(synthesizedEn, "article");

        const runData = {
            run_id: nextRunId++,
            plan_hash: planHash,
            processed_ids: task.processed_ids,
            subject: task.subject,
            profile: task.profile || Object.keys(generators)[0],
            synthesis_en: synthesizedEn,
            synthesis_kor: synthesizedKor,
        };

        for (const platform of ['linkedin', 'x', 'facebook', 'threads']) {
            const snsContent = composeForSns(platform, synthesizedEn, { title: task.subject });
            if (snsContent.error) {
                console.warn(`    ⚠️  Could not compose for ${platform}: ${snsContent.error}`);
                continue;
            }
            runData[`${platform}_en`] = snsContent.text.join('\n\n');
            const koreanSnsContent = await translateText(snsContent.text.join('\n\n'), platform);
            runData[`${platform}_kor`] = koreanSnsContent;
        }
        
        // Use Papaparse to safely convert the single record to a CSV string
        // Note: We only provide the data, not headers, for appending.
        const csvString = Papa.unparse([runData], {
            header: false,
            quotes: true, // Ensure all fields are quoted
            newline: '\n'
        });

        // Append the single, correctly formatted CSV row
        await fs.appendFile(RUNS_FILE_PATH, csvString + '\n', "utf-8");
        console.log(`📊 Appended new run (ID: ${runData.run_id}) to master log: ${RUNS_FILE_PATH}`);
    }
}

main().catch(e => {
    console.error("A critical error occurred in the main process:", e);
});
