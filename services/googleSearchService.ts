/**
 * Google Custom Search API Service
 * Fetches URLs directly from Google Search using Custom Search API
 *
 * Setup Required:
 * 1. Create a Custom Search Engine at: https://programmablesearchengine.google.com/
 * 2. Get your API key from: https://console.cloud.google.com/apis/credentials
 * 3. Add to .env:
 *    - GOOGLE_SEARCH_API_KEY=your_api_key
 *    - GOOGLE_SEARCH_ENGINE_ID=your_cse_id
 */

interface GoogleSearchResult {
	title: string;
	link: string;
	snippet: string;
	displayLink: string;
}

interface GoogleSearchResponse {
	items?: GoogleSearchResult[];
	searchInformation?: {
		totalResults: string;
	};
}

/**
 * Search Google directly using Custom Search API
 * Returns top 5 URLs related to the query
 */
export const searchGoogleForUrls = async (
	query: string,
	apiKey?: string,
	cseId?: string
): Promise<string[]> => {
	const searchApiKey = apiKey || process.env.GOOGLE_SEARCH_API_KEY;
	const searchEngineId = cseId || process.env.GOOGLE_SEARCH_ENGINE_ID;

	if (!searchApiKey || !searchEngineId) {
		throw new Error(
			'Google Custom Search API credentials not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID in your .env file.'
		);
	}

	try {
		// Google Custom Search API endpoint
		const apiUrl = 'https://www.googleapis.com/customsearch/v1';

		// Build query parameters
		const params = new URLSearchParams({
			key: searchApiKey,
			cx: searchEngineId,
			q: query,
			num: '10', // Get up to 10 results (API max per request)
			safe: 'active', // Safe search
		});

		console.log(`   🔍 Searching Google for: "${query}"`);

		const response = await fetch(`${apiUrl}?${params.toString()}`);

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const errorMessage = errorData.error?.message || '';

			// Check if it's an API configuration issue (403, API not enabled, etc.)
			const isConfigError =
				response.status === 403 ||
				errorMessage.includes('has not been used') ||
				errorMessage.includes('is disabled') ||
				errorMessage.includes('Enable it by visiting');

			if (isConfigError) {
				// Silently throw a special error that will trigger fallback
				const silentError: any = new Error(
					'API_NOT_CONFIGURED'
				);
				silentError.isConfigError = true;
				silentError.status = response.status;
				throw silentError;
			}

			// For other errors, throw normally
			throw new Error(
				`Google Custom Search API failed: ${response.status} ${response.statusText}. ${errorMessage}`
			);
		}

		const data: GoogleSearchResponse = await response.json();

		if (!data.items || data.items.length === 0) {
			console.log('   ⚠️ No search results found');
			return [];
		}

		// Extract URLs from results
		const urls = data.items
			.map((item) => item.link)
			.filter((url): url is string => {
				// Validate URL
				if (!url || typeof url !== 'string') return false;
				try {
					new URL(url);
					return true;
				} catch {
					return false;
				}
			})
			.slice(0, 5); // Return top 5 URLs

		console.log(`   ✅ Found ${urls.length} URLs from Google Search`);
		urls.forEach((url, idx) => {
			console.log(`      ${idx + 1}. ${url}`);
		});

		return urls;
	} catch (err: any) {
		// Only log non-configuration errors
		if (!err.isConfigError) {
			console.error(
				'   ❌ Google Custom Search API error:',
				err.message
			);
		}
		throw err;
	}
};

/**
 * Check if Google Custom Search API is configured
 */
export const isGoogleSearchConfigured = (): boolean => {
	return !!(
		process.env.GOOGLE_SEARCH_API_KEY &&
		process.env.GOOGLE_SEARCH_ENGINE_ID
	);
};
