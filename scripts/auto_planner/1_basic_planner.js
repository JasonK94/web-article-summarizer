import { promises as fs } from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { stringify as csvStringify } from 'csv-stringify/sync';
import 'dotenv/config';

// --- Configuration ---
const DATA_DIR = path.join(process.cwd(), 'data');
const PROCESSED_FILE = path.join(DATA_DIR, '2_processed', 'processed_content.csv');
const OUTPUT_FILE = path.join(DATA_DIR, '3_plans', 'auto_generated_plan.csv');
const CONFIG_PATH = path.join(process.cwd(), 'config', 'profiles.json');

// Thresholds
const MIN_CONTENT_LENGTH = 500;
const MIN_TITLE_LENGTH = 10;
const GENERIC_TITLES = ['youtube', 'instagram', 'n/a', 'blog', 'post', 'threads', 'blocked', '중국'];

// --- Helper Functions ---

function isGeneric(title) {
  const normalizedTitle = title.toLowerCase().trim();
  return GENERIC_TITLES.some(generic => normalizedTitle === generic || normalizedTitle.includes(generic));
}

function cleanTitle(title) {
  // Remove common noise patterns
  let cleaned = title
    .replace(/^\s*[-|•]\s*/g, '')  // Remove leading dashes/bullets
    .replace(/\s*[-|]\s*$/g, '')    // Remove trailing dashes
    .replace(/\.{3,}/g, '')         // Remove ellipsis
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim();
  
  // Limit length
  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 97) + '...';
  }
  
  return cleaned;
}

function extractFirstSentence(content) {
  if (!content) return '';
  
  // Find first sentence (ending with . ! or ?)
  const match = content.match(/^[^.!?]+[.!?]/);
  if (match) {
    return cleanTitle(match[0]);
  }
  
  // Fallback: first 100 chars
  return cleanTitle(content.substring(0, 100));
}

function extractKeywords(content) {
  if (!content) return [];
  
  const text = content.toLowerCase();
  const keywords = [];
  
  // Business/Finance keywords
  const businessKeywords = ['investment', 'market', 'stock', 'finance', 'trading', 'economy', 'business', '투자', '시장', '주식', '경제'];
  businessKeywords.forEach(kw => {
    if (text.includes(kw)) keywords.push(kw);
  });
  
  // Science/Research keywords
  const scienceKeywords = ['study', 'research', 'university', 'science', 'experiment', 'discovery', '연구', '과학', '실험'];
  scienceKeywords.forEach(kw => {
    if (text.includes(kw)) keywords.push(kw);
  });
  
  // Technology keywords
  const techKeywords = ['ai', 'artificial intelligence', 'machine learning', 'algorithm', 'software', 'code', '인공지능', '알고리즘', '소프트웨어'];
  techKeywords.forEach(kw => {
    if (text.includes(kw)) keywords.push(kw);
  });
  
  // Health/Medical keywords
  const healthKeywords = ['health', 'medical', 'disease', 'treatment', 'patient', 'doctor', '건강', '의료', '질병', '치료'];
  healthKeywords.forEach(kw => {
    if (text.includes(kw)) keywords.push(kw);
  });
  
  return keywords;
}

function selectProfile(article, config) {
  const content = (article.content || '').toLowerCase();
  const title = (article.title || '').toLowerCase();
  const combinedText = `${title} ${content}`;
  
  const keywords = extractKeywords(combinedText);
  
  // For now, use the default generator profile
  const generators = config.generators || {};
  const generatorKeys = Object.keys(generators);
  
  if (generatorKeys.length > 0) {
    return generatorKeys[0];  // Use first available generator
  }
  
  return 'sns_draft_v1';  // Fallback
}

function generateSubject(article, config) {
  const title = article.title || '';
  const content = article.content || '';
  
  // Strategy 1: Use article title if valid
  if (title && title.length >= MIN_TITLE_LENGTH && !isGeneric(title)) {
    return cleanTitle(title);
  }
  
  // Strategy 2: Extract first sentence
  const firstSentence = extractFirstSentence(content);
  if (firstSentence && firstSentence.length > MIN_TITLE_LENGTH) {
    return firstSentence;
  }
  
  // Strategy 3: Use source name + topic indicator
  const sourceName = article.source_name || 'Unknown Source';
  return `Article from ${sourceName}`;
}

function isValidArticle(article) {
  // Check scraping status
  if (article.scraping_status !== 'success') {
    return false;
  }
  
  // Check content length
  const contentLength = (article.content || '').length;
  if (contentLength < MIN_CONTENT_LENGTH) {
    return false;
  }
  
  // Check if it's a valid ID
  if (!article.processed_id || isNaN(parseInt(article.processed_id))) {
    return false;
  }
  
  return true;
}

// --- Main Logic ---

async function generateBasicPlan() {
  console.log('🤖 Auto-Planner: Basic Individual Article Processing');
  console.log('---------------------------------------------------');
  
  // Load configuration
  let config;
  try {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  } catch (error) {
    console.error(`❌ Failed to load config: ${error.message}`);
    process.exit(1);
  }
  
  const defaults = config.defaults || {};
  const defaultProvider = defaults.provider || 'openai';
  const defaultModel = defaults.generator_model || 'gpt-4o-mini';
  
  // Load processed content
  console.log(`📂 Reading: ${PROCESSED_FILE}`);
  let processedContent;
  try {
    const csvContent = await fs.readFile(PROCESSED_FILE, 'utf-8');
    const parseResult = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      bom: true
    });
    processedContent = parseResult.data;
    console.log(`   Found ${processedContent.length} processed articles`);
  } catch (error) {
    console.error(`❌ Failed to read processed content: ${error.message}`);
    process.exit(1);
  }
  
  // Generate plan entries
  const planEntries = [];
  let validCount = 0;
  let skippedCount = 0;
  
  for (const article of processedContent) {
    if (isValidArticle(article)) {
      const subject = generateSubject(article, config);
      const profile = selectProfile(article, config);
      
      planEntries.push({
        processed_ids: article.processed_id,
        subject: subject,
        provider: defaultProvider,
        model: defaultModel,
        profile: profile
      });
      
      validCount++;
      console.log(`   ✓ [${article.processed_id}] ${subject.substring(0, 60)}${subject.length > 60 ? '...' : ''}`);
    } else {
      skippedCount++;
      const reason = article.scraping_status !== 'success' 
        ? `status: ${article.scraping_status}` 
        : `content too short (${(article.content || '').length} chars)`;
      console.log(`   ✗ [${article.processed_id || '?'}] Skipped (${reason})`);
    }
  }
  
  // Write plan CSV
  if (planEntries.length > 0) {
    const csvContent = csvStringify(planEntries, {
      header: true,
      quoted: true,
      bom: true
    });
    
    await fs.writeFile(OUTPUT_FILE, csvContent, 'utf-8');
    console.log('');
    console.log('✅ Plan generation complete!');
    console.log(`   📊 Valid articles: ${validCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   📝 Output: ${OUTPUT_FILE}`);
  } else {
    console.log('');
    console.log('⚠️  No valid articles found to create a plan.');
  }
}

// Run the planner
generateBasicPlan().catch(error => {
  console.error('❌ Auto-planner failed:', error);
  process.exit(1);
});
