import fs from 'fs';
import path from 'path';
import { composeForSns } from './sns-composer.js';

const contentFilePath = path.join(process.cwd(), 'output', 'https_www_wsj_com_business_ballmer-clippers-leonard-sanberg-aspiration-49924b19_mod_hp_lead_pos7_1.manual.md');
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


try {
  ensureDirectoryExists(outputDir);
  const rawContent = fs.readFileSync(contentFilePath, 'utf-8');
  
  const englishSummary = rawContent.split('## English Summary')[1].split('## Korean Summary')[0];
  const koreanSummary = rawContent.split('## Korean Summary')[1];

  const platformsToGenerate = ['x', 'threads', 'linkedin', 'facebook'];
  const articleName = path.basename(contentFilePath, '.manual.md');
  
  console.log('Generating SNS content...');

  for (const platform of platformsToGenerate) {
    // Generate English content
    const enContent = composeForSns(englishSummary, platform, 'en');
    const enOutputDir = path.join(outputDir, articleName, 'en');
    writeSnsContentToFile(enOutputDir, enContent);

    // Generate Korean content
    const koContent = composeForSns(koreanSummary, platform, 'ko');
    const koOutputDir = path.join(outputDir, articleName, 'ko');
    writeSnsContentToFile(koOutputDir, koContent);
    
    console.log(`- Generated content for ${platform} (EN/KO)`);
  }

  console.log(`\n✅ SNS content generated successfully in:\n${path.join(outputDir, articleName)}`);

} catch (error) {
  console.error('❌ Error generating SNS content:', error.message);
}
