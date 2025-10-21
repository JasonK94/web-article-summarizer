import { extractKeywords } from './utils/keyword_extractor.js';

function expandWithAI(keywords, title) {
    // This is a placeholder. In a real implementation, this would call an AI service.
    return `Analysis of: ${title}`;
}

function getCategory(title) {
    // This is a placeholder. In a real implementation, this would categorize the title.
    if (title.toLowerCase().includes('tech')) {
        return 'Technology';
    }
    return 'General';
}

function applyTemplate(expandedSubject, category) {
    // This is a placeholder. In a real implementation, this would apply a template based on the category.
    return expandedSubject;
}


export function generateSubject(title) {
    // 1. 제목에서 핵심 키워드 추출
    const keywords = extractKeywords(title);
    
    // 2. AI를 활용한 주제 확장 (placeholder)
    const expandedSubject = expandWithAI(keywords, title);
    
    // 3. 카테고리별 주제 템플릿 적용 (placeholder)
    const categorizedSubject = applyTemplate(expandedSubject, getCategory(title));
    
    return categorizedSubject;
}
