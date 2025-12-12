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
export const getUserLanguage = async (userId: string | null | undefined): Promise<string> => {
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
			console.warn(`⚠️ [USER] User not found for userId: ${userId}, defaulting to English`);
			return 'en';
		}

		// Convert enum to string (e.g., enum_users_language.en -> 'en')
		const language = user.language || 'en';
		console.log(`✅ [USER] Language fetched for userId ${userId}: ${language}`);
		return language;
	} catch (error) {
		console.error(`❌ [USER] Error fetching language for userId ${userId}:`, error);
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

// Graceful shutdown
process.on('beforeExit', async () => {
	await prisma.$disconnect();
});

