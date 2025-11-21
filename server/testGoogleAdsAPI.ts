import { config } from 'dotenv';
import { tokenManager } from './tokenManager.js';

config();

interface GoogleAdsKeywordResult {
	text?: string;
	keywordIdeaMetrics?: {
		avgMonthlySearches?: number;
		competition?: string;
		competitionIndex?: number;
		lowTopOfPageBidMicros?: number;
		highTopOfPageBidMicros?: number;
	};
}

interface GoogleAdsResponse {
	results?: GoogleAdsKeywordResult[];
	error?: {
		message?: string;
	};
}

const testGoogleAdsAPI = async (): Promise<void> => {
	const keyword = 'digital marketing'; // Change this to test different keywords

	console.log('🔍 Testing Google Ads REST API with Auto Token Refresh...');
	console.log(`Keyword: "${keyword}"`);
	console.log(`Customer ID: ${process.env.GOOGLE_ADS_CUSTOMER_ID}\n`);

	const url = `https://googleads.googleapis.com/v21/customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}:generateKeywordIdeas`;

	const body = {
		customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
		includeAdultKeywords: false,
		keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
		keywordSeed: {
			keywords: [keyword]
		},
		pageSize: 20
	};

	try {
		// Automatically get valid token (will refresh if expired)
		const accessToken = await tokenManager.getValidToken();

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
				'Authorization': `Bearer ${accessToken}`
			},
			body: JSON.stringify(body)
		});

		console.log(`📡 Response Status: ${response.status} ${response.statusText}\n`);

		const data: GoogleAdsResponse = await response.json();

		if (response.ok && data.results) {
			console.log(`✅ Success! Found ${data.results.length} keyword ideas:\n`);

			// Display first 5 results with detailed metrics
			data.results.slice(0, 5).forEach((result, index) => {
				const metrics = result.keywordIdeaMetrics || {};
				console.log(`${index + 1}. Keyword: "${result.text}"`);
				console.log(`   - Avg Monthly Searches: ${metrics.avgMonthlySearches || 'N/A'}`);
				console.log(`   - Competition: ${metrics.competition || 'N/A'}`);
				console.log(`   - Low Top Page Bid: ${metrics.lowTopOfPageBidMicros ? '$' + (metrics.lowTopOfPageBidMicros / 1000000).toFixed(2) : 'N/A'}`);
				console.log(`   - High Top Page Bid: ${metrics.highTopOfPageBidMicros ? '$' + (metrics.highTopOfPageBidMicros / 1000000).toFixed(2) : 'N/A'}`);
				console.log('');
			});

			if (data.results.length > 5) {
				console.log(`... and ${data.results.length - 5} more results\n`);
			}

			// Uncomment to see full response
			// console.log('📄 Full response data:');
			// console.log(JSON.stringify(data, null, 2));
		} else {
			console.error('❌ Error Response:');
			console.error(JSON.stringify(data, null, 2));

			if (data.error && data.error.message) {
				console.error(`\n💡 Error Message: ${data.error.message}`);
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('❌ Error:', errorMessage);
		console.error(error);
	}
};

// Run the test
testGoogleAdsAPI();


