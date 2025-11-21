import { config } from 'dotenv';
config();

class TokenManager {
	private accessToken: string | null = null;
	private tokenExpiry: number | null = null;

	/**
	 * Get a valid access token, automatically refreshing if needed
	 */
	async getValidToken(): Promise<string> {
		// Check if token exists and is still valid (with 5-minute buffer)
		if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
			console.log('✅ [TokenManager] Using cached access token');
			return this.accessToken;
		}

		console.log('🔄 [TokenManager] Access token expired or missing, refreshing...');
		return await this.refreshToken();
	}

	/**
	 * Refresh the access token using refresh token
	 */
	async refreshToken(): Promise<string> {
		const url = 'https://oauth2.googleapis.com/token';
		const body = {
			client_id: process.env.CLIENT_ID,
			client_secret: process.env.CLIENT_SECRET,
			refresh_token: process.env.REFRESH_TOKEN,
			grant_type: 'refresh_token'
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(`Token refresh failed: ${JSON.stringify(errorData)}`);
			}

			const data: any = await response.json();
			this.accessToken = data.access_token;
			// Set expiry (typically 3600 seconds/1 hour)
			this.tokenExpiry = Date.now() + (data.expires_in * 1000);

			console.log(`✅ [TokenManager] New access token obtained (expires in ${data.expires_in} seconds)`);
			return this.accessToken;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('❌ [TokenManager] Error refreshing access token:', errorMessage);
			throw error;
		}
	}

	/**
	 * Manually set an access token (useful for testing)
	 */
	setToken(token: string, expiresIn: number = 3600): void {
		this.accessToken = token;
		this.tokenExpiry = Date.now() + (expiresIn * 1000);
		console.log(`✅ [TokenManager] Access token manually set (expires in ${expiresIn} seconds)`);
	}

	/**
	 * Clear the cached token (force refresh on next request)
	 */
	clearToken(): void {
		this.accessToken = null;
		this.tokenExpiry = null;
		console.log('🧹 [TokenManager] Access token cleared');
	}
}

// Create and export singleton instance
export const tokenManager = new TokenManager();


