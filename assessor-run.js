import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";
import { parse as csvParse } from "csv-parse/sync";
import { logApiUsage } from "./logger.js";

const runId = new Date().toISOString().replace(/[:.]/g, '-');
console.log(JSON.stringify({ ts: new Date().toISOString(), tag: "run:start", script: process.argv[1], args: process.argv.slice(2), runId }));

const profiles = JSON.parse(await fs.readFile("config/profiles.json","utf-8"));

const config = {
  provider: (process.env.PROVIDER || "openai").toLowerCase(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  assessors: (process.env.ASSESSORS || "professor,business_guru,investor,general").split(","),
  assessorModel: process.env.ASSESSOR_MODEL
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genai = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const outDir = path.resolve("evaluation");
await fs.mkdir(outDir, { recursive: true });

// Load summaries from all_runs.csv to assess
let summariesToAssess = [];
try {
  const csvRaw = await fs.readFile(path.resolve("output", "all_runs.csv"), "utf-8");
  if (!csvRaw || csvRaw.trim().length === 0) {
    throw new Error("all_runs.csv is empty or does not exist.");
  }
  summariesToAssess = csvParse(csvRaw, { columns: true, skip_empty_lines: true });
  if (summariesToAssess.length === 0) {
    console.warn("WARN: all_runs.csv contains only a header or is empty. No summaries to assess.");
  }
} catch (e) {
  console.error(`Fatal error reading or parsing output/all_runs.csv: ${e.message}`);
  process.exit(1);
}

function buildPrompt(assessorKey, title, summary){
  const a = profiles.assessors[assessorKey];
  const criteria = a.criteria.join(", ");
  return `You are ${a.name}.

Evaluate the following SUMMARY of an article titled: "${title}".

Provide your response in the following format, using the exact headers and separators:

### VERDICT
(Your one-sentence verdict on the summary's quality)

### ASSESSMENT
(Your detailed assessment of the summary based on your persona)

### METRICS
(A single JSON object with scores (0-10) for these criteria: ${criteria})

### IMPROVEMENTS
(Optional: concrete suggestions on how the summary could be improved)

---
SUMMARY TO ASSESS:
${summary}`;
}

async function assessOne(provider, model, assessorKey, title, summary){
  const prompt = buildPrompt(assessorKey, title, summary);
  let text = "";
  let tokensUsed = 0;
  if (provider === "openai"){
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: profiles.assessors[assessorKey].system_prompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 800
    });
    text = resp.choices[0].message.content;
    tokensUsed = resp.usage.total_tokens;
  } else if (provider === "gemini"){
    if (!genai) throw new Error("GEMINI_API_KEY not set");
    const gmodel = genai.getGenerativeModel({ model: model || "gemini-2.5-pro" });
    const resp = await gmodel.generateContent(`System: ${profiles.assessors[assessorKey].system_prompt}\n\nUser: ${prompt}`);
    text = resp.response.text();
    tokensUsed = Math.round((prompt.length + text.length) / 4);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const cost = tokensUsed * (profiles.models[model]?.cost_per_1k_tokens || 0) / 1000;
  await logApiUsage({ provider, model, tokensUsed, cost, function: "assess" });

  return text;
}

const allAssessors = Object.fromEntries(
  config.assessors.map(key => [key, profiles.assessors[key]]).filter(entry => entry[1])
);
const allCriteria = Array.from(new Set(Object.values(allAssessors).flatMap(a => a.criteria)));

const assessmentResults = [];
for (const summaryRow of summariesToAssess) {
  const assessmentsForThisSummary = {};
  for (const assessorKey of config.assessors) {
    console.log(`> Assessing summary #${summaryRow.No} by ${assessorKey}...`);
    try {
      const assessorModel = config.assessorModel || (config.provider === 'openai' ? config.openaiModel : config.geminiModel);
      const rawAssessment = await assessOne(config.provider, assessorModel, assessorKey, summaryRow.Title, summaryRow.Summary);

      const verdictMatch = rawAssessment.match(/### VERDICT\s*([\s\S]*?)\s*(?:### ASSESSMENT|$)/);
      const assessmentMatch = rawAssessment.match(/### ASSESSMENT\s*([\s\S]*?)\s*(?:### METRICS|$)/);
      const metricsMatch = rawAssessment.match(/### METRICS\s*(\{[\s\S]*?\})\s*(### IMPROVEMENTS|$)/);
      const improvementsMatch = rawAssessment.match(/### IMPROVEMENTS\s*([\s\S]*)/);

      assessmentsForThisSummary[assessorKey] = {
        verdict: verdictMatch ? verdictMatch[1].trim() : "Parsing Error",
        assessment: assessmentMatch ? assessmentMatch[1].trim() : "Parsing Error",
        metrics: metricsMatch ? JSON.parse(metricsMatch[1].replace(/\n/g, ' ')) : {},
        improvements: improvementsMatch ? improvementsMatch[1].trim() : "Parsing Error"
      };
      console.log(`  ✓ Assessed #${summaryRow.No} by ${assessorKey}`);
    } catch (e) {
      console.log(`  ✗ Assess error for summary #${summaryRow.No} by ${assessorKey}: ${e.message}`);
      assessmentsForThisSummary[assessorKey] = { verdict: "Assessment Failed", assessment: e.message, metrics: {}, improvements: "" };
    }
  }
  assessmentResults.push({
    summaryNo: summaryRow.No,
    title: summaryRow.Title,
    url: summaryRow.URL,
    model: summaryRow.Model,
    profile: summaryRow.Profile,
    assessments: assessmentsForThisSummary
  });
}

// --- Write to CSV in Wide Format ---
const assessCsvPath = path.join(outDir, "assessment_results.csv");

// Dynamic headers based on assessors and their criteria
const header = ["Summary No", "Title", "URL", "Model", "Profile", "Overall Score"];
const allCriteriaUnique = [...new Set(Object.values(allAssessors).flatMap(a => a.criteria))];
header.push(...allCriteriaUnique.map(c => `AVG ${c}`));

for (const assessorKey of config.assessors) {
  header.push(`${assessorKey} Verdict`, `${assessorKey} Assessment`, `${assessorKey} Improvements`);
  const assessorCriteria = profiles.assessors[assessorKey]?.criteria || [];
  for (const crit of assessorCriteria) {
    header.push(`${assessorKey} ${crit}`);
  }
}

const rowsForCsv = assessmentResults.map(result => {
  const row = [
    result.summaryNo,
    result.title,
    result.url,
    result.model,
    result.profile
  ];

  // Calculate overall and average metrics
  let totalScore = 0;
  let scoreCount = 0;
  const criteriaTotals = {};
  const criteriaCounts = {};

  for (const assessorKey of config.assessors) {
    const assessment = result.assessments[assessorKey];
    if (assessment && assessment.metrics) {
      for (const score of Object.values(assessment.metrics)) {
        if (typeof score === 'number') {
          totalScore += score;
          scoreCount++;
        }
      }
      for (const [crit, score] of Object.entries(assessment.metrics)) {
        if (typeof score === 'number') {
          criteriaTotals[crit] = (criteriaTotals[crit] || 0) + score;
          criteriaCounts[crit] = (criteriaCounts[crit] || 0) + 1;
        }
      }
    }
  }

  const overallAvg = scoreCount > 0 ? (totalScore / scoreCount).toFixed(2) : "N/A";
  row.push(overallAvg);

  for (const crit of allCriteriaUnique) {
    const avg = (criteriaCounts[crit] || 0) > 0 ? (criteriaTotals[crit] / criteriaCounts[crit]).toFixed(2) : "N/A";
    row.push(avg);
  }

  // Add individual assessor details
  for (const assessorKey of config.assessors) {
    const assessment = result.assessments[assessorKey] || {};
    row.push(assessment.verdict || "", assessment.assessment || "", assessment.improvements || "");
    const assessorCriteria = profiles.assessors[assessorKey]?.criteria || [];
    for (const crit of assessorCriteria) {
      row.push(assessment.metrics?.[crit] ?? "N/A");
    }
  }
  
  return row.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",");
});

const toCsv = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
const csvContent = header.join(",") + "\n" + rowsForCsv.join("\n");
await fs.writeFile(assessCsvPath, csvContent, "utf-8");

console.log(`Saved: ${assessCsvPath}`);
console.log(JSON.stringify({ ts: new Date().toISOString(), tag: "run:end", script: process.argv[1], runId, filesCreated: 1 }));
process.exit(0);


