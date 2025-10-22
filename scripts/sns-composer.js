
/**
 * @typedef {Object} SnsContent
 * @property {string} platform - The target social media platform.
 * @property {string[]} text - An array of text snippets for the post (e.g., a thread for X).
 * @property {string[]} [hashtags] - An array of suggested hashtags.
 * @property {Object[]} [carousel] - An array of objects representing carousel slides.
 * @property {string} [carousel[].title] - The title for a carousel slide.
 * @property {string} [carousel[].body] - The body text for a carousel slide.
 * @property {Object} [videoScript] - An object representing a short-form video script.
 * @property {string} [videoScript.hook] - The opening hook for the video.
 * @property {Object[]} [videoScript.scenes] - An array of scenes for the video.
 * @property {string} [videoScript.scenes[].scene] - Description of the scene.
 * @property {string} [videoScript.scenes[].visual] - Suggestion for the visual element.
 * @property {string} [videoScript.scenes[].voiceover] - The voiceover script for the scene.
 * @property {string} [videoScript.cta] - The call to action at the end of the video.
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
 * Composes content for X (formerly Twitter) or Threads.
 * @param {string} content - The raw text content.
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForX(content) {
  const cleanedContent = cleanContent(content);
  const sentences = getSentences(cleanedContent);
  const tweets = [];
  let currentTweet = '';

  sentences.forEach((sentence) => {
    const trimmedSentence = sentence.trim();
    if (trimmedSentence.length === 0) return;

    if (currentTweet.length + trimmedSentence.length + 1 < X_CHARACTER_LIMIT) {
      currentTweet += `${trimmedSentence} `;
    } else {
      tweets.push(currentTweet.trim());
      currentTweet = `${trimmedSentence} `;
    }
  });

  if (currentTweet) {
    tweets.push(currentTweet.trim());
  }

  const numberedTweets = tweets.map((tweet, index) => `(${index + 1}/${tweets.length}) ${tweet}`);

  // In a real implementation, we would generate hashtags based on content.
  const hashtags = ['#AI', '#Tech', '#Innovation'];

  return {
    platform: 'x',
    text: numberedTweets,
    hashtags,
  };
}

/**
 * Composes content for LinkedIn.
 * @param {string} content - The raw text content.
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForLinkedIn(content) {
  const cleanedContent = cleanContent(content);
  const sentences = getSentences(cleanedContent);
  const post = sentences.join(' ');

  // For LinkedIn, we can also generate a carousel.
  // This is a simplified example. A real implementation would be more sophisticated.
  const carousel = [
    {
      title: 'Investment Brief: Aspiration Bank',
      body: 'An analysis of the Aspiration Bank fraud case and its market impact.',
    },
    {
      title: 'Key Financial Implications',
      body: 'Direct investor losses of $248M and potential penalties for the Clippers.',
    },
    {
      title: 'Risk Assessment',
      body: 'Highlights fraud risk in private markets and failures in due diligence.',
    },
    {
      title: 'Investment Opportunities',
      body: 'Demand for enhanced due diligence and RegTech solutions is expected to rise.',
    },
  ];

  const hashtags = ['#Fintech', '#Investment', '#SportsBiz', '#DueDiligence'];

  return {
    platform: 'linkedin',
    text: [post],
    carousel,
    hashtags,
  };
}

/**
 * Composes content for Facebook.
 * @param {string} content - The raw text content.
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForFacebook(content) {
  const cleanedContent = cleanContent(content);
  const sentences = getSentences(cleanedContent);
  const post = `Here's a look at the Aspiration Bank situation: ${sentences.join(' ')} What are your thoughts on this? Let us know in the comments! 👇`;
  
  const hashtags = ['#AspirationBank', '#FintechScandal', '#NBA', '#BusinessNews'];

  return {
    platform: 'facebook',
    text: [post],
    hashtags,
  };
}

/**
 * Transforms raw content into a format suitable for a specific social media platform.
 *
 * @param {string} platform - The target social media platform (e.g., 'x', 'linkedin', 'short_form_video').
 * @param {string} content - The raw text content (e.g., an article).
 * @returns {SnsContent} An object containing the formatted content.
 */
function composeForSns(platform, content) {
  switch (platform) {
    case 'x':
    case 'threads':
      return composeForX(content);
    case 'linkedin':
      return composeForLinkedIn(content);
    case 'instagram_post':
      // return composeForInstagramPost(content);
      throw new Error('Not implemented yet');
    case 'facebook':
      return composeForFacebook(content);
    case 'short_form_video':
      // return composeForShortFormVideo(content);
      throw new Error('Not implemented yet');
    case 'naver-blog':
        return {
            text: [content] // No splitting needed
        };
    default:
        return {
            error: `Unsupported platform: ${platform}`
        };
  }
}

export {
  composeForSns,
};
