<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

## Server function (Google Ads Keyword API)

- Set these in .env.local (server-side only; not exposed to client):
     - GOOGLE_ADS_DEVELOPER_TOKEN
     - GOOGLE_ADS_CLIENT_ID
     - GOOGLE_ADS_CLIENT_SECRET
     - GOOGLE_ADS_REFRESH_TOKEN
     - GOOGLE_ADS_CUSTOMER_ID
     - GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional)
- Start API server only: `npm run serve:api`
- Run client + API together: `npm run dev:full`

## Google Custom Search API (Optional - for direct Google URL fetching)

- **Why**: Get URLs directly from Google instead of using Gemini's web search tool
- **Setup**:
     1. Create a Custom Search Engine: https://programmablesearchengine.google.com/
           - Click "Add" → "Search the entire web"
           - Get your Search Engine ID (CSE ID)
     2. Get API Key: https://console.cloud.google.com/apis/credentials
           - Enable "Custom Search API"
           - Create API key
     3. Add to .env.local:
           - `GOOGLE_SEARCH_API_KEY=your_api_key`
           - `GOOGLE_SEARCH_ENGINE_ID=your_cse_id`
- **Note**: If not configured, the system will fallback to Gemini's web search tool
- **Free Tier**: 100 queries/day

Client switch (to call server instead of local simulation)

- In .env.local add:
     - VITE_KEYWORD_API_MODE=server
     - VITE_KEYWORD_API_BASE=http://localhost:3001 (dev) or your deployed API origin

Gemini BYOK (CSR)

- The Gemini API key input stays client-side (BYOK). It is not baked into the bundle; users provide it at runtime.

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/12Mo6iLGBtLjeNpw0NBZpm4Y0y6I3TxOs

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
