/**
 * Shared validation utilities for blog generation
 */

/**
 * Validates if a topic is valid (not gibberish or irrelevant)
 */
export const isValidTopic = (topic: string | null | undefined): boolean => {
    if (!topic || !topic.trim()) return false;

    const trimmed = topic.trim();

    // Too short to be meaningful
    if (trimmed.length < 3) return false;

    // Check for common invalid patterns
    const invalidPatterns = [
        /^[^a-zA-Z]*$/, // No letters at all
        /^(blog|it|yourself|everything|anything|something|whatever|random)$/i, // Common invalid words
        /^[a-z]{1,2}$/i, // Single or double letter
    ];

    for (const pattern of invalidPatterns) {
        if (pattern.test(trimmed)) return false;
    }

    // Check for gibberish: too many repeated characters or random character sequences
    const hasRepeatedChars = /(.)\1{4,}/.test(trimmed); // Same char repeated 5+ times
    const hasRandomChars = /[^a-zA-Z0-9\s]{3,}/.test(trimmed); // 3+ special chars in a row
    const tooManySpecialChars =
        (trimmed.match(/[^a-zA-Z0-9\s]/g) || []).length >
        trimmed.length * 0.3; // More than 30% special chars

    if (hasRepeatedChars || hasRandomChars || tooManySpecialChars)
        return false;

    // Check if it looks like random keyboard mashing (no vowels or all consonants)
    const hasVowels = /[aeiouAEIOU]/.test(trimmed);
    const consonantRatio =
        (
            trimmed.match(
                /[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g
            ) || []
        ).length / trimmed.length;

    // If no vowels and high consonant ratio, likely gibberish
    if (!hasVowels && consonantRatio > 0.7 && trimmed.length > 5)
        return false;

    // Check for common words that aren't topics
    const commonNonTopics = [
        'yes',
        'no',
        'ok',
        'okay',
        'sure',
        'maybe',
        'thanks',
        'thank you',
    ];
    if (commonNonTopics.includes(trimmed.toLowerCase())) return false;

    return true;
};

/**
 * Detects if input is gibberish/nonsensical
 */
export const isGibberish = (text: string): boolean => {
    if (!text || text.trim().length < 3) return false;

    const trimmed = text.trim();

    // Check for random character sequences
    const vowels = (trimmed.match(/[aeiouAEIOU]/g) || []).length;
    const consonants = (
        trimmed.match(/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g) || []
    ).length;
    const totalLetters = vowels + consonants;

    if (totalLetters === 0) return true;

    const vowelRatio = vowels / totalLetters;
    if (vowelRatio < 0.15 && trimmed.length > 8) return true;

    const hasRepeatedPattern = /(.{2,})\1{2,}/.test(trimmed);
    if (hasRepeatedPattern && trimmed.length > 10) return true;

    const letterRatio = totalLetters / trimmed.length;
    if (letterRatio < 0.5 && trimmed.length > 5) return true;

    return false;
};
