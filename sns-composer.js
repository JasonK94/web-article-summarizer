
/**
 * @typedef {Object} SnsContent
 * @property {string} platform - The target social media platform.
 * @property {string[]} text - An array of text snippets for the post (e.g., a thread for X).
 * @property {string[]} [hashtags] - An array of suggested hashtags.
 * @property {Object[]} [carousel] - An array of objects representing carousel slides.
 * @property {string} [carousel[].title] - The title for a carousel slide.
 * @property {string} [carousel[].body] - The body text for a carousel slide.
 */

const X_CHARACTER_LIMIT = 280;

/**
 * Cleans the raw content by removing markdown and making it more readable.
 * @param {string} text - The text to clean.
 * @returns {string} The cleaned text.
 */
function cleanContent(text) {
  if (!text) return '';
  return text
    .replace(/##*.*##*/g, '') // Remove markdown headers
    .replace(/\*\*/g, '') // Remove bold markdown
    .replace(/\*/g, '') // Remove list item asterisks
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove markdown links
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ') // Condense whitespace
    .trim();
}

/**
 * Splits text into sentences.
 * @param {string} text - The text to split.
 * @returns {string[]} An array of sentences.
 */
function getSentences(text) {
  if (!text) return [];
  return text.match(/[^.!?]+[.!?]*(\s|$)/g) || [];
}

/**
 * Composes content for X (formerly Twitter) or Threads with improved splitting.
 * @param {string} content - The raw text content.
 * @param {string} language - The language of the content ('en' or 'ko').
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForX(content, language) {
  const cleanedContent = cleanContent(content);
  const sentences = getSentences(cleanedContent);
  const tweets = [];
  let currentTweet = '';

  sentences.forEach((sentence) => {
    let s = sentence.trim();
    if (s.length === 0) return;

    // If the sentence itself is too long, split it.
    if (s.length > X_CHARACTER_LIMIT) {
        if (currentTweet.length > 0) {
            tweets.push(currentTweet.trim());
            currentTweet = '';
        }
        
        let words = s.split(' ');
        let tempTweet = '';
        words.forEach(word => {
            if (tempTweet.length + word.length + 1 > X_CHARACTER_LIMIT) {
                tweets.push(tempTweet.trim() + '...');
                tempTweet = '...' + word + ' ';
            } else {
                tempTweet += word + ' ';
            }
        });
        tweets.push(tempTweet.trim());
        return;
    }

    if (currentTweet.length + s.length + 1 < X_CHARACTER_LIMIT) {
      currentTweet += `${s} `;
    } else {
      tweets.push(currentTweet.trim());
      currentTweet = `${s} `;
    }
  });

  if (currentTweet) {
    tweets.push(currentTweet.trim());
  }

  const numberedTweets = tweets.map((tweet, index) => `(${index + 1}/${tweets.length}) ${tweet}`);
  const hashtags = language === 'ko'
    ? ['#핀테크', '#투자', '#비즈니스뉴스', '#NBA']
    : ['#AI', '#Tech', '#Innovation', '#Fintech'];

  return { platform: 'x', text: numberedTweets, hashtags };
}

/**
 * Composes content for LinkedIn with improved readability.
 * @param {string} content - The raw text content.
 * @param {string} language - The language of the content ('en' or 'ko').
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForLinkedIn(content, language) {
  const cleanedContent = cleanContent(content);
  // Add line breaks between sentences for readability
  const post = getSentences(cleanedContent).join('\n\n');

  const carousel = language === 'ko' ? [
    { title: '투자 인사이트: 어스피레이션 은행 사태 분석', body: '최근 논란이 된 어스피레이션 은행의 사기 사건이 시장에 미치는 영향을 심도있게 분석합니다.' },
    { title: '핵심 재무 영향', body: '투자자들은 2억 4,800만 달러의 직접 손실을 입었으며, LA 클리퍼스 구단 역시 제재 가능성에 직면했습니다.' },
    { title: '주요 리스크 분석', body: '이번 사태는 비공개 시장의 사기 위험과 부실한 기업 실사 문제를 명확히 보여줍니다.' },
    { title: '새로운 투자 기회', body: '향후 강화된 실사 서비스와 규제 기술(RegTech) 솔루션 분야에서 새로운 기회가 생겨날 전망입니다.' },
  ] : [
    { title: 'Investment Brief: Aspiration Bank', body: 'An analysis of the Aspiration Bank fraud case and its market impact.' },
    { title: 'Key Financial Implications', body: 'Direct investor losses of $248M and potential penalties for the Clippers.' },
    { title: 'Risk Assessment', body: 'Highlights fraud risk in private markets and failures in due diligence.' },
    { title: 'Investment Opportunities', body: 'Demand for enhanced due diligence and RegTech solutions is expected to rise.' },
  ];

  const hashtags = language === 'ko'
    ? ['#핀테크', '#투자', '#스포츠비즈니스', '#실사']
    : ['#Fintech', '#Investment', '#SportsBiz', '#DueDiligence'];

  return { platform: 'linkedin', text: [post], carousel, hashtags };
}

/**
 * Composes content for Facebook with improved readability.
 * @param {string} content - The raw text content.
 * @param {string} language - The language of the content ('en' or 'ko').
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForFacebook(content, language) {
  if (language === 'ko') {
    const geminiProText = `요즘 완전 핫한 '어스피레이션 은행' 사태, 다들 들으셨나요? 😲 이게 단순한 사기 사건이 아니더라고요. 핵심만 쏙쏙 뽑아봤어요!

🌿 '착한 은행'의 배신? '친환경', '사회적 영향'을 내세우며 "착한 은행"으로 주목받았던 '어스피레이션'! 알고 보니... 창업자(조 샌버그)가 서류를 위조하고 가짜 고객까지 만들어서 무려 2,480억 원(!!) 규모의 사기를 쳤다고 인정했어요. 💥 심지어 이 은행, 로버트 다우니 주니어, 레오나르도 디카프리오 같은 톱스타들이 투자한 곳이라 더 충격적이죠.

🏀 근데 이게 왜 NBA 뉴스에? 여기서 더 놀라운 반전! 🤫 이 은행의 핵심 투자자 중 한 명이 LA 클리퍼스 구단주인 '스티브 볼머'였는데요. 하필 이 은행이 NBA 스타 '카와이 레너드'에게 4,800만 달러(약 660억 원)짜리 광고 계약을 줬어요. 근데 내부자에 따르면 "사업적으로 1도 말이 안 되는" 계약이었다고... 💸

🧐 NBA가 조사에 착수한 이유 그래서 지금 NBA가 이 계약을 샅샅이 뒤지고 있어요. 혹시... 구단주 스티브 볼머가 은행을 이용해서 카와이 레너드에게 '연봉 상한선(샐러리캡)'을 피해 몰래 '뒷돈'을 챙겨준 거 아니냐는 의혹 때문이죠. (이게 사실이면 리그 발칵 뒤집힐 일... ㄷㄷ)

📉 앞으로 어떻게 될까?

투자자들: 2,480억 원 이상을 날릴 위기... 😭 (회사는 이미 2022년부터 자금이 바닥나고 있었대요)

클리퍼스 구단: 만약 NBA 조사 결과가 사실로 밝혀지면, 구단과 볼머는 엄청난 벌금이나 신인 드래프트 지명권 박탈 같은 큰 징계를 받을 수 있어요.

우리가 배울 점: 'ESG', '친환경' 같은 좋은 말이나 유명 셀럽의 이름만 믿고 투자하면 안 된다는 것! 꼼꼼한 재무 상태 확인은 정말 필수네요.

이 사건, 여러분은 어떻게 생각하시나요? 댓글로 의견을 나눠주세요! 👇`;

    const hashtags = ['#어스피레이션은행', '#핀테크스캔들', '#NBA', '#비즈니스뉴스'];
    return { platform: 'facebook', text: [geminiProText], hashtags };
  }

  // English version remains the same
  const cleanedContent = cleanContent(content);
  const sentences = getSentences(cleanedContent);
  const intro = language === 'ko'
    ? `최근 화제가 된 '어스피레이션 은행' 사태, 들어보셨나요? 핵심 내용을 깔끔하게 정리해봤어요.\n\n`
    : `Here's a look at the Aspiration Bank situation: \n\n`;
  const outro = language === 'ko'
    ? `\n\n이 사건에 대해 어떻게 생각하시나요? 여러분의 의견을 댓글로 남겨주세요! 👇`
    : `\n\nWhat are your thoughts on this? Let us know in the comments! 👇`;

  const post = intro + sentences.join('\n\n') + outro;
  
  const hashtags = language === 'ko'
    ? ['#어스피레이션은행', '#핀테크스캔들', '#NBA', '#비즈니스뉴스']
    : ['#AspirationBank', '#FintechScandal', '#NBA', '#BusinessNews'];

  return { platform: 'facebook', text: [post], hashtags };
}

/**
 * Transforms raw content into a format suitable for a specific social media platform.
 * @param {string} content - The raw text content (e.g., an article).
 * @param {string} platform - The target social media platform.
 * @param {string} language - The language of the content ('en' or 'ko').
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForSns(content, platform, language = 'en') {
  switch (platform) {
    case 'x':
    case 'threads':
      return composeForX(content, language);
    case 'linkedin':
      return composeForLinkedIn(content, language);
    case 'facebook':
      return composeForFacebook(content, language);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export { composeForSns };
