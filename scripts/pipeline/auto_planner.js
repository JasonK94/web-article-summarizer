import { promises as fs } from 'fs';
import Papa from 'papaparse';
import { generateSubject } from './subject_generator.js';
import { selectProfile } from './profile_selector.js';

const PROCESSED_CONTENT_PATH = 'data/2_processed/processed_content.csv';
const AUTO_PLAN_PATH = 'data/3_planned/auto_plan.csv';

async function loadProcessedContent() {
    const csvFile = await fs.readFile(PROCESSED_CONTENT_PATH, 'utf8');
    return Papa.parse(csvFile, { header: true, skipEmptyLines: true }).data;
}

async function saveAutoPlan(autoPlanEntries) {
    await fs.mkdir('data/3_planned', { recursive: true });
    const csv = Papa.unparse(autoPlanEntries);
    await fs.writeFile(AUTO_PLAN_PATH, csv);
}

async function processIndividualArticles(processedContent) {
    const autoPlanEntries = [];
    
    for (const item of processedContent) {
        const autoPlanEntry = {
            processed_ids: item.processed_id,
            subject: generateSubject(item.title),
            provider: "auto",
            model: "",
            profile: selectProfile(item.source_type, item.title)
        };
        autoPlanEntries.push(autoPlanEntry);
    }
    
    return autoPlanEntries;
}

export async function generateAutoPlan(options = {}) {
    const {
        mode = 'individual',  // 'individual' | 'group' | 'hybrid'
        minSimilarity = 0.7,
        maxGroupSize = 5
    } = options;
    
    console.log(`🤖 Generating auto plan in ${mode} mode...`);
    
    // 1. 데이터 로드
    const processedContent = await loadProcessedContent();
    
    // 2. 모드별 처리
    let autoPlanEntries;
    switch (mode) {
        case 'individual':
            autoPlanEntries = await processIndividualArticles(processedContent);
            break;
        case 'group':
            // autoPlanEntries = await processGrouped(processedContent, minSimilarity);
            console.log("Group mode not implemented yet.");
            autoPlanEntries = [];
            break;
        case 'hybrid':
            // autoPlanEntries = await processHybrid(processedContent, minSimilarity, maxGroupSize);
            console.log("Hybrid mode not implemented yet.");
            autoPlanEntries = [];
            break;
    }
    
    // 3. 결과 저장
    await saveAutoPlan(autoPlanEntries);
    
    console.log(`✅ Generated ${autoPlanEntries.length} auto plan entries`);
    return autoPlanEntries;
}

generateAutoPlan();
