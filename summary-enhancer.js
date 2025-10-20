import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";
import { parse as csvParse, stringify as csvStringify } from "csv-parse/sync";
import { logApiUsage } from "./logger.js";

const runId = new Date().toISOString().replace(/[:.]/g, '-');
console.log(JSON.stringify({ ts: new Date().toISOString(), tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId }));

const profiles = JSON.parse(await fs.readFile("config/profiles.json","utf-8"));

const config = {
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  enhancer: "professional"
};

// --- CLI argument parsing ---
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--enhancer" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args.enhancer = argv[++i];
    }
    if (a === "--provider" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args.provider = argv[++i].toLowerCase();
    }
    if (a === "--model" && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args.model = argv[++i];
    }
  }
  return args;
}

const cli = parseArgs(process.argv);
if (cli.enhancer) config.enhancer = cli.enhancer;
if (cli.provider) config.provider = cli.provider;
if (cli.model) config.model = cli.model;

const enhancerProfile = profiles.enhancers[config.enhancer];
if (!enhancerProfile) {
  console.error(`Enhancer profile '${config.enhancer}' not found in config/profiles.json`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genai = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function enhanceSummary(provider, model, systemPrompt, summary) {
  const userPrompt = `Please revise the following summary:\n\n${summary}`;
  let enhancedSummary = "";
  let tokensUsed = 0;

  if (provider === "openai") {
    const resp = await openai.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.5,
      max_tokens: 2000
    });
    enhancedSummary = resp.choices[0].message.content;
    tokensUsed = resp.usage.total_tokens;
  } else if (provider === "gemini") {
    if (!genai) throw new Error("GEMINI_API_KEY not set");
    const gmodel = genai.getGenerativeModel({ model });
    const resp = await gmodel.generateContent(`System: ${systemPrompt}\n\nUser: ${userPrompt}`);
    enhancedSummary = resp.response.text();
    tokensUsed = Math.round((systemPrompt.length + userPrompt.length + enhancedSummary.length) / 4);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const cost = tokensUsed * (profiles.models[model]?.cost_per_1k_tokens || 0) / 1000;
  await logApiUsage({ provider, model, tokensUsed, cost, function: "enhance" });

  return enhancedSummary;
}

async function main() {
  const allRunsPath = path.resolve("output", "all_runs.csv");
  let records = [];
  try {
    const csvRaw = await fs.readFile(allRunsPath, "utf-8");
    records = csvParse(csvRaw, { columns: true, skip_empty_lines: true });
  } catch (e) {
    console.error(`Could not read output/all_runs.csv: ${e.message}`);
    process.exit(1);
  }

  const newColumnName = `enhanced_${config.enhancer}_summary`;
  console.log(`Enhancing summaries with profile '${config.enhancer}' into new column '${newColumnName}'...`);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    console.log(`> Enhancing summary #${record.No}...`);
    try {
      const enhanced = await enhanceSummary(config.provider, config.model, enhancerProfile.system_prompt, record.Summary);
      record[newColumnName] = enhanced;
      console.log(`  ✓ Enhanced summary #${record.No}`);
    } catch (e) {
      console.log(`  ✗ Enhancement failed for summary #${record.No}: ${e.message}`);
      record[newColumnName] = `ENHANCEMENT_FAILED: ${e.message}`;
    }
  }

  // Ensure the new column is in the header before stringifying
  const headers = Object.keys(records[0]);
  if (!headers.includes(newColumnName)) {
      // This should not happen if records are updated correctly, but as a safeguard:
      const allHeaders = [...new Set([...Object.keys(records[0]), ...records.flatMap(Object.keys)])];
      // A more robust way would be to get all headers from all records
  }
  
  const updatedCsv = csvStringify(records, { header: true });
  await fs.writeFile(allRunsPath, updatedCsv, "utf-8");

  console.log(`\n✅ Successfully updated ${allRunsPath} with ${records.length} enhanced summaries.`);
  console.log(JSON.stringify({ ts: new Date().toISOString(), tag: "run:end", script: process.argv[1], runId, filesCreated: 0, filesUpdated: 1 }));
}

main();
