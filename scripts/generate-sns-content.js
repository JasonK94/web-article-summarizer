import fs from 'fs';
import path from 'path';
import { composeForSns } from './sns-composer.js';
import { logEvent } from './logger.js';

const outputDir = path.join(process.cwd(), 'output', 'sns-posts');

/**
 * Creates a directory if it doesn't exist.
 * @param {string} dirPath - The path to the directory.
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Finds a unique directory path by appending a number if the directory already exists.
 * @param {string} baseDir - The base directory path.
 * @returns {string} A unique directory path.
 */
function getUniqueOutputDir(baseDir) {
  if (!fs.existsSync(baseDir)) {
    return baseDir;
  }
  let i = 1;
  while (fs.existsSync(`${baseDir}_${i}`)) {
    i++;
  }
  return `${baseDir}_${i}`;
}

/**
 * Writes the generated SNS content to files.
 * @param {string} baseDir - The base directory for the output.
 * @param {SnsContent} snsContent - The content to write.
 */
function writeSnsContentToFile(baseDir, snsContent) {
  ensureDirectoryExists(baseDir);

  const platform = snsContent.platform;
  let fileContent = '';

  if (snsContent.text) {
    fileContent += snsContent.text.join('\n\n---\n\n');
  }

  if (snsContent.hashtags) {
    fileContent += `\n\nHashtags: ${snsContent.hashtags.join(' ')}`;
  }

  if (platform === 'linkedin' && snsContent.carousel) {
    fileContent += '\n\n--- Carousel ---\n\n';
    snsContent.carousel.forEach((slide, index) => {
      fileContent += `Slide ${index + 1}:\n`;
      fileContent += `Title: ${slide.title}\n`;
      fileContent += `Body: ${slide.body}\n\n`;
    });
    fs.writeFileSync(path.join(baseDir, `${platform}.md`), fileContent);
  } else {
    fs.writeFileSync(path.join(baseDir, `${platform}.txt`), fileContent);
  }
}


/**
 * Main function to generate SNS content.
 * @param {string} contentFilePath - Path to the content file.
 */
async function generateSnsContent(contentFilePath) {
  try {
    ensureDirectoryExists(outputDir);
    const rawContent = fs.readFileSync(contentFilePath, 'utf-8');
    
    // Extract just the English summary
    const englishSummaryMatch = rawContent.match(/## English Summary([\s\S]*?)## Korean Summary/);
    if (!englishSummaryMatch || !englishSummaryMatch[1]) {
      console.error('Could not find English summary in the content file.');
      return;
    }
    const englishSummary = englishSummaryMatch[1];
  
    const platformsToGenerate = ['x', 'threads', 'linkedin', 'facebook'];
    
    const articleBaseName = path.basename(contentFilePath, '.manual.md');
    const articleOutputDir = getUniqueOutputDir(path.join(outputDir, articleBaseName));
    ensureDirectoryExists(articleOutputDir);

    console.log('Generating SNS content...');
  
    for (const platform of platformsToGenerate) {
      const snsContent = composeForSns(englishSummary, platform);
      writeSnsContentToFile(articleOutputDir, snsContent);
      console.log(`- Generated content for ${platform}`);
    }

    const logMessage = {
      event: 'sns_content_generation',
      inputFile: contentFilePath,
      outputDir: articleOutputDir,
      platforms: platformsToGenerate,
      status: 'success'
    };
    await logEvent(logMessage);
  
    console.log(`\n✅ SNS content generated successfully in:\n${articleOutputDir}`);
  
  } catch (error) {
    console.error('❌ Error generating SNS content:', error.message);
    const logMessage = {
      event: 'sns_content_generation',
      inputFile: contentFilePath,
      status: 'error',
      error: error.message,
    };
    await logEvent(logMessage);
  }
}

// Check for command-line argument for the content file
if (process.argv.length < 3) {
  console.error('Usage: node scripts/generate-sns-content.js <path_to_content_file>');
  process.exit(1);
}

const contentFilePath = process.argv[2];
generateSnsContent(contentFilePath);
