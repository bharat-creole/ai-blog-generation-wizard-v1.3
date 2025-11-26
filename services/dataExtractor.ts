import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';

export interface ExtractedBlogData {
	topic?: string;
	primaryKeyword?: string;
	secondaryKeywords?: string[];
	title?: string;
	targetLocation?: string;
	tone?: string;
	interlinks?: { keyword: string; url: string }[];
	referenceUrls?: string[];
}

// Helper to safely extract text from Gemini response (handles non-text parts like thoughtSignature)
const extractTextFromResponse = (response: GenerateContentResponse): string => {
	// Always extract text parts directly to avoid triggering warning from response.text getter
	try {
		if (response.candidates && response.candidates[0]?.content?.parts) {
			const textParts = response.candidates[0].content.parts
				.filter((part: any) => part.text !== undefined)
				.map((part: any) => part.text)
				.join('');

			if (textParts) {
				return textParts;
			}
		}
	} catch (e) {
		console.error('❌ Failed to extract text from response:', e);
	}

	throw new Error('Unable to extract text from Gemini response');
};

const cleanAndParseJson = (text: string): any => {
	const cleanedText = text
		.replace(/^```json\s*/, '')
		.replace(/```\s*$/, '')
		.trim();
	return JSON.parse(cleanedText);
};

export const extractDataFromMessage = async (
	message: string,
	apiKey: string
): Promise<ExtractedBlogData> => {
	if (!apiKey) throw new Error('API Key is required.');
	const ai = new GoogleGenAI({ apiKey });

	const prompt = `
You are a data extraction expert. Extract structured blog-related information from the user's message.

USER MESSAGE: "${message}"

INSTRUCTIONS:
Extract any of the following information if present:
- topic: The main subject/topic for the blog
- primaryKeyword: Main SEO keyword
- secondaryKeywords: Additional SEO keywords (array)
- title: Proposed blog title
- targetLocation: Target country/region
- tone: Writing tone (e.g., professional, casual, educational)
- interlinks: Internal/external links with format [{keyword, url}]
- referenceUrls: Reference URLs to use

IMPORTANT:
- Only extract data that is explicitly mentioned
- Set fields to null if not mentioned
- Be smart about inferring relationships (e.g., if title contains a keyword, extract it)
- Parse different input formats (natural language, structured, JSON-like)

EXAMPLES:

Input: "Write about cloud computing in USA, target keyword 'aws services'"
Output: {
  "topic": "cloud computing",
  "primaryKeyword": "aws services",
  "targetLocation": "USA"
}

Input: "Topic: AI in healthcare. Keywords: machine learning, neural networks, AI diagnosis. Title: How AI is Revolutionizing Healthcare"
Output: {
  "topic": "AI in healthcare",
  "secondaryKeywords": ["machine learning", "neural networks", "AI diagnosis"],
  "title": "How AI is Revolutionizing Healthcare"
}

Input: "Blog on databases, link to my RDS article https://mysite.com/rds"
Output: {
  "topic": "databases",
  "referenceUrls": ["https://mysite.com/rds"]
}

Input: "United States"
Output: {
  "targetLocation": "United States"
}

Input: "Canada"
Output: {
  "targetLocation": "Canada"
}

Input: "for United Kingdom"
Output: {
  "targetLocation": "United Kingdom"
}
`;

	const responseSchema = {
		type: Type.OBJECT,
		properties: {
			topic: { type: Type.STRING, nullable: true },
			primaryKeyword: { type: Type.STRING, nullable: true },
			secondaryKeywords: {
				type: Type.ARRAY,
				items: { type: Type.STRING },
				nullable: true,
			},
			title: { type: Type.STRING, nullable: true },
			targetLocation: { type: Type.STRING, nullable: true },
			tone: { type: Type.STRING, nullable: true },
			interlinks: {
				type: Type.ARRAY,
				items: {
					type: Type.OBJECT,
					properties: {
						keyword: { type: Type.STRING },
						url: { type: Type.STRING },
					},
				},
				nullable: true,
			},
			referenceUrls: {
				type: Type.ARRAY,
				items: { type: Type.STRING },
				nullable: true,
			},
		},
	};

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: { parts: [{ text: prompt }] },
		config: {
			responseMimeType: 'application/json',
			responseSchema: responseSchema,
		},
	});

	return cleanAndParseJson(extractTextFromResponse(response));
};

export const extractSeedsFromTitle = (title: string): string[] => {
	if (!title) return [];
	// Remove common stop words
	const stopWords = new Set([
		'the',
		'a',
		'an',
		'and',
		'or',
		'but',
		'in',
		'on',
		'at',
		'to',
		'for',
		'of',
		'with',
		'by',
		'from',
		'is',
		'are',
		'was',
		'were',
		'been',
		'be',
		'have',
		'has',
		'had',
		'do',
		'does',
		'did',
		'will',
		'would',
		'could',
		'should',
		'may',
		'might',
		'must',
		'can',
		'how',
		'what',
		'when',
		'where',
		'why',
		'which',
		'who',
		'your',
		'you',
		'guide',
		'complete',
		'best',
		'top',
	]);

	const words = title
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));

	// Create 2-3 word phrases
	const phrases: string[] = [];
	for (let i = 0; i < words.length; i++) {
		if (i + 1 < words.length) {
			phrases.push(`${words[i]} ${words[i + 1]}`);
		}
		if (i + 2 < words.length) {
			phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
		}
	}

	return [...new Set(phrases)].slice(0, 3);
};
