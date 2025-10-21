// This is a placeholder for a keyword extraction function.
// In a real implementation, this would use a library like 'natural' or 'rake-js'.
export function extractKeywords(text) {
    // Simple keyword extraction: split by space and filter out short words.
    return text.split(' ').filter(word => word.length > 3);
}
