import fs from "fs/promises";
import path from "path";

const profilesPath = path.resolve("config","profiles.json");
const outDir = path.resolve("output");
await fs.mkdir(outDir,{recursive:true});

const cfg = JSON.parse(await fs.readFile(profilesPath,"utf-8"));
const rows = ["Model,Name,Description,Cost per 1k tokens,Max tokens,Recommended for"]; 
for (const [key,info] of Object.entries(cfg.models)){
  rows.push([
    key,
    info.name,
    info.description,
    info.cost_per_1k_tokens,
    info.max_tokens,
    (info.recommended_for||[]).join('|')
  ].map(v=>`"${(v??'').toString().replace(/"/g,'"')}"`).join(','));
}

await fs.writeFile(path.join(outDir,"api_models_table.csv"), rows.join("\n"), "utf-8");
console.log("Updated output/api_models_table.csv");
process.exit(0);


