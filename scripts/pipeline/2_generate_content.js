import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import "dotenv/config";
import { setupGlobalErrorHandling, logEvent } from "../logger.js";
import { composeForSns } from "../sns-composer.js";

setupGlobalErrorHandling();

const PROCESSED_FILE_PATH = path.resolve(process.cwd(), "data", "2_processed", "processed_content.csv");
const PLANS_DIR = path.resolve(process.cwd(), "data", "3_plans");
const RUNS_FILE_PATH = path.resolve(process.cwd(), "data", "4_runs", "all_runs.csv");
const OUTPUT_DIR = path.resolve(process.cwd(), "output");

/**
 * Creates a sanitized, concise name for a folder from a subject line.
 * @param {string} subject - The subject of the content.
 * @returns {string} A filesystem-safe string.
 */
function getConciseName(subject) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sanitizedSubject = subject.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  return `${sanitizedSubject}_${date}`;
}

/**
 * Finds a unique directory path by appending a number if the directory already exists.
 * @param {string} baseDir - The base directory path.
 * @returns {string} A unique directory path.
 */
function getUniqueOutputDir(baseDir) {
  if (!existsSync(baseDir)) {
    return baseDir;
  }
  let i = 1;
  while (existsSync(`${baseDir}_${i}`)) {
    i++;
  }
  return `${baseDir}_${i}`;
}

async function main() {
  console.log("🚀 Starting content generation from plan...");
  await logEvent({ event: "generation_start", script: "2_generate_content.js" });

  // 1. Load Processed Content
  const processedContentCsv = await fs.readFile(PROCESSED_FILE_PATH, "utf-8");
  const processedContent = csvParse(processedContentCsv, { columns: true, skip_empty_lines: true });
  const contentMap = new Map(processedContent.map(item => [item.processed_id, item]));

  // 2. Load Plan
  const planPath = path.join(PLANS_DIR, "manual_plan.csv"); // Hardcoded for now
  const planCsv = await fs.readFile(planPath, "utf-8");
  const plan = csvParse(planCsv, { columns: true, skip_empty_lines: true });

  const allRuns = [];

  // 3. Execute Plan
  for (const task of plan) {
    const idsToCombine = task.processed_ids.split(',').map(id => id.trim());
    let combinedContent = "";
    
    for (const id of idsToCombine) {
      if (contentMap.has(id)) {
        const item = contentMap.get(id);
        combinedContent += `--- Article: ${item.title} ---\n${item.content}\n\n`;
      }
    }

    if (!combinedContent) {
      console.log(`⚠️  Skipping task for subject "${task.subject}" as no content was found.`);
      continue;
    }

    // This is where the call to an AI model for synthesis would go.
    // For now, we'll just use the combined content as the source for SNS posts.
    console.log(`✍️  Generating content for subject: "${task.subject}"`);

    // 4. Create Output Files & Folders
    const conciseName = getConciseName(task.subject);
    const outputBaseDir = path.join(OUTPUT_DIR, conciseName);
    const outputFinalDir = getUniqueOutputDir(outputBaseDir);
    await fs.mkdir(outputFinalDir, { recursive: true });

    const platforms = ['linkedin', 'x', 'facebook', 'threads'];
    const runData = {
      run_id: allRuns.length + 1,
      name: conciseName,
      location: path.relative(process.cwd(), outputFinalDir),
    };

    for (const platform of platforms) {
      // Use the existing sns-composer to generate placeholder content
      const snsContent = composeForSns(combinedContent, platform);
      const filePath = path.join(outputFinalDir, `${platform}.md`);
      await fs.writeFile(filePath, snsContent.text.join('\n\n'));

      // For the all_runs.csv, store the generated text
      runData[platform] = snsContent.text.join('\\n\\n');
      
      // TODO: Add Korean translation step here
      runData[`${platform}_kor`] = "Placeholder for Korean translation.";
    }
    
    allRuns.push(runData);
    console.log(`✅ Content written to: ${outputFinalDir}`);
  }

  // 5. Update all_runs.csv
  if (allRuns.length > 0) {
    const csvString = csvStringify(allRuns, { header: true });
    await fs.writeFile(RUNS_FILE_PATH, csvString, "utf-8");
    console.log(`📊 Updated master log: ${RUNS_FILE_PATH}`);
  }

  await logEvent({ event: "generation_end", script: "2_generate_content.js", tasks_processed: plan.length });
}

main();
