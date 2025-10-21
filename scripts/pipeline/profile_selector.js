export function selectProfile(sourceType, title) {
    const profileMap = {
        'nature': 'scientific_analysis',
        'quantamagazine.org': 'tech_analysis',
        'eopla.net': 'business_analysis',
        'realty.chosun.com': 'real_estate_analysis',
        'hani.co.kr': 'news_analysis',
        'm.blog.naver.com': 'blog_analysis',
        'docdocdoc.co.kr': 'medical_analysis',
        'news.hada.io': 'tech_news_analysis',
        'youtu.be': 'video_content_analysis'
    };
    
    // 소스 타입 기반 기본 할당
    let profile = profileMap[sourceType] || 'general_analysis';
    
    // 제목 키워드 기반 세부 조정
    if (title.includes('AI') || title.includes('기술')) {
        profile = 'tech_analysis';
    } else if (title.includes('창업') || title.includes('비즈니스')) {
        profile = 'business_analysis';
    } else if (title.includes('의료') || title.includes('건강')) {
        profile = 'medical_analysis';
    }
    
    return profile;
}
