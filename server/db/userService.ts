// server/db/userService.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get user language from database
 * Falls back to 'en' (English) if user not found or any error occurs
 *
 * @param userId - User ID (UUID string)
 * @returns Language code (e.g., 'en', 'es', 'zh', 'de') - defaults to 'en'
 */
export const getUserLanguage = async (
	userId: string | null | undefined
): Promise<string> => {
	// Default to English if no userId provided
	if (!userId) {
		console.log('⚠️ [USER] No userId provided, defaulting to English');
		return 'en';
	}

	try {
		const user = await prisma.users.findUnique({
			where: { id: userId },
			select: { language: true },
		});

		if (!user) {
			console.warn(
				`⚠️ [USER] User not found for userId: ${userId}, defaulting to English`
			);
			return 'en';
		}

		// Convert enum to string (e.g., enum_users_language.en -> 'en')
		const language = user.language || 'en';
		console.log(
			`✅ [USER] Language fetched for userId ${userId}: ${language}`
		);
		return language;
	} catch (error) {
		console.error(
			`❌ [USER] Error fetching language for userId ${userId}:`,
			error
		);
		// Fallback to English on any error
		return 'en';
	}
};

/**
 * Map language enum to human-readable language name for prompts
 *
 * @param languageCode - Language code from enum (e.g., 'en', 'es', 'zh', 'zh_HK', 'de')
 * @returns Human-readable language name
 */
export const getLanguageName = (languageCode: string): string => {
	const languageMap: Record<string, string> = {
		en: 'English',
		es: 'Spanish',
		zh: 'Chinese (Simplified)',
		'zh-HK': 'Chinese (Traditional - Hong Kong)',
		zh_HK: 'Chinese (Traditional - Hong Kong)',
		de: 'German',
	};

	return languageMap[languageCode] || 'English';
};

/**
 * Get user model from database
 * Falls back to 'gemini_2_5_flash' (Gemini) if user not found or any error occurs
 *
 * @param userId - User ID (UUID string)
 * @returns Model code (e.g., 'gpt_4o', 'gemini_2_5_flash', 'gemini_1_5_pro') - defaults to 'gemini_2_5_flash'
 */
export const getUserModel = async (
	userId: string | null | undefined
): Promise<string> => {
	// Default to Gemini if no userId provided
	if (!userId) {
		console.log(
			'⚠️ [USER] No userId provided, defaulting to Gemini model'
		);
		return 'gemini_2_5_flash';
	}

	try {
		const user = await prisma.users.findUnique({
			where: { id: userId },
			select: { model: true },
		});

		if (!user) {
			console.warn(
				`⚠️ [USER] User not found for userId: ${userId}, defaulting to Gemini model`
			);
			return 'gemini_2_5_flash';
		}

		// Convert enum to string (e.g., enum_users_model.gemini_2_5_flash -> 'gemini_2_5_flash')
		const model = user.model || 'gemini_2_5_flash';
		console.log(
			`✅ [USER] Model fetched for userId ${userId}: ${model}`
		);
		return model;
	} catch (error) {
		console.error(
			`❌ [USER] Error fetching model for userId ${userId}:`,
			error
		);
		// Fallback to Gemini on any error
		return 'gemini_2_5_flash';
	}
};

/**
 * Detect if model is GPT or Gemini
 *
 * @param model - Model code from database (e.g., 'gpt_4o', 'gemini_2_5_flash')
 * @returns 'gpt' | 'gemini' | 'gemini' (default fallback)
 */
export const detectModelType = (model: string): 'gpt' | 'gemini' => {
	if (!model) {
		return 'gemini'; // Default fallback
	}

	const normalizedModel = model.toLowerCase().trim();

	// Check if it's a GPT model
	if (
		normalizedModel.startsWith('gpt') ||
		normalizedModel.includes('gpt-')
	) {
		return 'gpt';
	}

	// Check if it's a Gemini model
	if (
		normalizedModel.startsWith('gemini') ||
		normalizedModel.includes('gemini')
	) {
		return 'gemini';
	}

	// Check for Claude models (fallback to Gemini)
	if (
		normalizedModel.startsWith('claude') ||
		normalizedModel.includes('claude')
	) {
		console.warn(
			`⚠️ [MODEL] Claude model detected (${model}), falling back to Gemini`
		);
		return 'gemini';
	}

	// Default fallback to Gemini for any other model
	console.warn(
		`⚠️ [MODEL] Unknown model type (${model}), falling back to Gemini`
	);
	return 'gemini';
};

/**
 * Map database model enum to actual API model name
 *
 * @param modelCode - Model code from database enum
 * @param modelType - Detected model type ('gpt' | 'gemini')
 * @returns Actual API model name
 */
export const getApiModelName = (
	modelCode: string,
	modelType: 'gpt' | 'gemini'
): string => {
	if (modelType === 'gpt') {
		// Map GPT enum values to OpenAI API model names
		const gptModelMap: Record<string, string> = {
			gpt_4o: 'gpt-4o',
			'gpt-4o': 'gpt-4o',
			gpt_o1_mini: 'o1-mini',
			'gpt-o1-mini': 'o1-mini',
			gpt_5: 'gpt-5',
			'gpt-5': 'gpt-5',
			o4_mini: 'o4-mini',
			'o4-mini': 'o4-mini',
		};

		return gptModelMap[modelCode] || 'gpt-4o'; // Default to gpt-4o
	} else {
		// Map Gemini enum values to Google API model names
		const geminiModelMap: Record<string, string> = {
			gemini_1_5_flash: 'gemini-1.5-flash',
			'gemini-1.5-flash': 'gemini-1.5-flash',
			gemini_1_5_pro: 'gemini-1.5-pro',
			'gemini-1.5-pro': 'gemini-1.5-pro',
			gemini_2_5_flash: 'gemini-2.5-flash',
			'gemini-2.5-flash': 'gemini-2.5-flash',
			gemini_2_5_pro: 'gemini-2.5-pro',
			'gemini-2.5-pro': 'gemini-2.5-pro',
		};

		return geminiModelMap[modelCode] || 'gemini-2.5-flash'; // Default to gemini-2.5-flash
	}
};

// Graceful shutdown
process.on('beforeExit', async () => {
	await prisma.$disconnect();
});
