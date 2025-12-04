import express from 'express';
import cors from 'cors';
import { config as dotenvConfig } from 'dotenv';

// Load env early (supports running via `npm run serve:api` from project root)
dotenvConfig({ path: process.env.DOTENV_PATH || '.env.local' });

// Import token manager for Google Ads REST API
import { tokenManager } from './tokenManager.js';

// Lazy import to support ESM + CJS interop
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import gadsPkg from 'google-ads-api';
const GoogleAdsApi = gadsPkg?.GoogleAdsApi || gadsPkg?.default?.GoogleAdsApi;

// Basic mapping for common locations used in the Wizard
const GEO: Record<string, string> = {
	'United States': 'geoTargetConstants/2840',
	'United Kingdom': 'geoTargetConstants/2826',
	Canada: 'geoTargetConstants/2124',
	Australia: 'geoTargetConstants/2036',
};
const ENGLISH = 'languageConstants/1000';

// Deterministic fallback (mirrors client-side simulation) in case credentials are missing or API fails
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}
function simulateIdeas(seed: string) {
	const base = seed.trim();
	const variants = Array.from(
		new Set(
			[
				base,
				`${base} guide`,
				`${base} best practices`,
				`${base} tutorial`,
				`${base} benefits`,
				`${base} vs alternatives`,
				`${base} checklist`,
				`${base} for beginners`,
			].map((t) => t.toLowerCase())
		)
	);
	return variants.map((v, i) => {
		const h = hash(v + i.toString());
		const volume = 200 + (h % 7800);
		const difficulty = ((h >> 8) % 100) / 100;
		return { text: v, volume, difficulty };
	});
}

const app = express();
// Increase body size limit to handle large state objects (e.g., base64 encoded files)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

app.get('/', (req, res) => {
	const { token, userId } = req.query;
	const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
	
	if (token) {
		// Redirect to frontend with token preserved
		const redirectUrl = new URL(frontendUrl);
		redirectUrl.searchParams.set('token', token as string);
		if (userId) {
			redirectUrl.searchParams.set('userId', userId as string);
		}
		console.log(`🔄 [Redirect] Redirecting to frontend: ${redirectUrl.toString()}`);
		return res.redirect(redirectUrl.toString());
	}
	
	// No token, just redirect to frontend
	console.log(`🔄 [Redirect] Redirecting to frontend: ${frontendUrl}`);
	res.redirect(frontendUrl);
});

app.post('/api/getKeywords', async (req, res) => {
	const { seed, location } = req.body || {};
	if (!seed || typeof seed !== 'string') {
		return res
			.status(400)
			.json({ error: 'Missing required field: seed' });
	}
	const geo = GEO[location] || GEO['United States'];

	const {
		GOOGLE_ADS_DEVELOPER_TOKEN,
		GOOGLE_ADS_CLIENT_ID,
		GOOGLE_ADS_CLIENT_SECRET,
		GOOGLE_ADS_REFRESH_TOKEN,
		GOOGLE_ADS_CUSTOMER_ID,
		GOOGLE_ADS_LOGIN_CUSTOMER_ID,
	} = process.env as Record<string, string | undefined>;

	const haveCreds = !!(
		GOOGLE_ADS_DEVELOPER_TOKEN &&
		GOOGLE_ADS_CLIENT_ID &&
		GOOGLE_ADS_CLIENT_SECRET &&
		GOOGLE_ADS_REFRESH_TOKEN &&
		GOOGLE_ADS_CUSTOMER_ID
	);

	if (!haveCreds || !GoogleAdsApi) {
		// Fallback to deterministic ideas so the endpoint still works
		return res.json({ rows: simulateIdeas(seed) });
	}

	try {
		const api = new GoogleAdsApi({
			client_id: GOOGLE_ADS_CLIENT_ID!,
			client_secret: GOOGLE_ADS_CLIENT_SECRET!,
			developer_token: GOOGLE_ADS_DEVELOPER_TOKEN!,
		});

		const customer = api.Customer({
			customer_id: (GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, ''),
			refresh_token: GOOGLE_ADS_REFRESH_TOKEN!,
			login_customer_id: GOOGLE_ADS_LOGIN_CUSTOMER_ID
				? GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '')
				: undefined,
		});

		// Try the Keyword Plan Ideas API via the wrapper; normalize output
		// Note: Library signatures can vary by version; we handle both common shapes
		let ideas: any[] = [];
		if (
			typeof (customer as any).keywordIdeas?.generate === 'function'
		) {
			ideas = await (customer as any).keywordIdeas.generate({
				customer_id: customer.cid,
				language_id: '1000',
				location_ids: [geo.split('/').pop()],
				keywords: [seed],
			});
		} else if (
			typeof (customer as any).keywordPlans
				?.generateKeywordIdeas === 'function'
		) {
			const resp = await (
				customer as any
			).keywordPlans.generateKeywordIdeas({
				customer_id: customer.cid,
				language: ENGLISH,
				geo_target_constants: [geo],
				keyword_seed: { keywords: [seed] },
			});
			ideas = Array.isArray(resp)
				? resp
				: resp?.results || resp?.keyword_ideas || [];
		} else {
			return res.status(500).json({
				error: 'Google Ads library does not expose a keyword ideas method in this runtime.',
			});
		}

		const rows = (ideas || [])
			.map((it: any) => {
				// Normalize common fields
				const text =
					it.text ||
					it.keyword ||
					it.keyword_text ||
					it?.keywordIdeaMetrics?.text ||
					'';
				const metrics =
					it.keyword_idea_metrics ||
					it.metrics ||
					it.keywordIdeaMetrics ||
					{};
				const avg =
					metrics.avg_monthly_searches ??
					metrics.avgMonthlySearches ??
					metrics.average_monthly_searches ??
					0;
				const comp =
					metrics.competition ??
					metrics.competition_index ??
					metrics.competitionIndex;
				// Normalize difficulty 0..1 from competition
				let difficulty = 0.5;
				if (typeof comp === 'number') {
					// If 0..100, scale; if 0..2 enum, map
					if (comp > 2)
						difficulty = Math.min(
							1,
							Math.max(0, comp / 100)
						);
					else difficulty = [0.2, 0.5, 0.8][comp] ?? 0.5;
				} else if (typeof comp === 'string') {
					const m: Record<string, number> = {
						LOW: 0.2,
						MEDIUM: 0.5,
						HIGH: 0.8,
					};
					difficulty = m[comp.toUpperCase()] ?? 0.5;
				}
				return { text, volume: Number(avg) || 0, difficulty };
			})
			.filter((r: any) => r.text);

		// If API returned empty, fallback to simulation
		if (!rows.length) return res.json({ rows: simulateIdeas(seed) });
		return res.json({ rows });
	} catch (err: any) {
		console.error('GAds keyword ideas error:', err?.message || err);
		return res.json({ rows: simulateIdeas(seed) });
	}
});

// 🔥 New endpoint: Google Ads REST API with OAuth2 token refresh
app.post('/api/getKeywordsGoogleAds', async (req, res) => {
	const { seed, location } = req.body || {};

	if (!seed || typeof seed !== 'string') {
		return res
			.status(400)
			.json({ error: 'Missing required field: seed' });
	}

	const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
	const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
	const hasOAuthCreds = !!(
		process.env.CLIENT_ID &&
		process.env.CLIENT_SECRET &&
		process.env.REFRESH_TOKEN
	);

	if (!customerId || !developerToken || !hasOAuthCreds) {
		return res.status(503).json({
			error: 'Google Ads REST API credentials not configured',
			rows: simulateIdeas(seed),
		});
	}

	const url = `https://googleads.googleapis.com/v21/customers/${customerId}:generateKeywordIdeas`;
	const body = {
		customerId: customerId,
		includeAdultKeywords: false,
		keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
		keywordSeed: {
			keywords: [seed],
		},
		pageSize: 20,
	};

	try {
		const accessToken = await tokenManager.getValidToken();

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'developer-token': developerToken,
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(body),
		});

		const data: any = await response.json();

		if (!response.ok) {
			const errorMessage =
				data.error?.message ||
				`API returned ${response.status}`;
			throw new Error(
				`Google Ads REST API failed: ${errorMessage}`
			);
		}

		if (data.results && data.results.length > 0) {
			// Transform Google Ads response to match expected format
			const rows = data.results
				.map((result: any) => {
					const metrics = result.keywordIdeaMetrics || {};
					const text = result.text || '';
					const volume = metrics.avgMonthlySearches || 0;

					// Map competition to difficulty (0..1)
					let difficulty = 0.5;
					if (metrics.competitionIndex !== undefined) {
						difficulty = metrics.competitionIndex / 100;
					} else if (metrics.competition) {
						const compMap: Record<string, number> = {
							LOW: 0.25,
							MEDIUM: 0.5,
							HIGH: 0.75,
						};
						difficulty =
							compMap[metrics.competition] || 0.5;
					}

					return {
						text,
						volume: Number(volume) || 0,
						difficulty,
					};
				})
				.filter((kw: any) => kw.text.trim() !== '');

			return res.json({ rows });
		} else {
			return res.json({ rows: simulateIdeas(seed) });
		}
	} catch (error: any) {
		// Return simulated data as fallback
		return res.json({ rows: simulateIdeas(seed) });
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 🤖 LangGraph Agent API Endpoints
// ═══════════════════════════════════════════════════════════════════════

import { graph, checkpointer } from './agent/graph.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { processMessage } from './agent/conversationHandler.js';
import { saveBlogIfComplete } from './hooks/blogCompletionHook.js';
import { authenticateToken, optionalAuth } from './middleware/auth.js';
import { saveAgentHistory } from './db/agentHistoryService.js';

// NEW: Main conversation endpoint - handles user messages with intent classification
// ✨ Added optionalAuth middleware to extract userId from JWT token
app.post('/api/agent/message', optionalAuth, async (req, res) => {
	const {
		message,
		threadId,
		currentState,
		apiKey, // Extract apiKey from request body, not from state
		stream = false,
	} = req.body || {};
	const userId = req.userId; // ✨ Extracted from JWT token by optionalAuth middleware
	console.log(`\n${'═'.repeat(70)}`);
	console.log(
		`💬 [AGENT] Message Request Received ${stream ? '(Streaming)' : ''}`
	);
	console.log(`${'═'.repeat(70)}`);
	console.log(`   Thread ID: ${threadId}`);
	console.log(`   User ID: ${userId || 'Not authenticated'}`); // ✨ Log userId
	console.log(`   Message: "${message}"`);

	if (!threadId || !message) {
		return res.status(400).json({
			error: 'threadId and message are required',
		});
	}

	// Get apiKey from request body, state, or environment variable (in that order)
	const apiKeyToUse = apiKey || currentState?.apiKey || process.env.GEMINI_API_KEY;
	if (!apiKeyToUse) {
		return res.status(400).json({
			error: 'apiKey is required. Please provide apiKey in request, state, or set GEMINI_API_KEY in your .env.local file.',
		});
	}

	// Remove apiKey from state to prevent storing it
	const sanitizedState = { ...currentState };
	delete sanitizedState.apiKey;

	// Setup streaming if requested
	if (stream) {
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.flushHeaders();
	}

	try {
		// Process message through conversation handler
		const response = await processMessage(
			message,
			sanitizedState,
			apiKeyToUse
		);

		console.log(
			`   📤 Response: "${response.assistantMessage.substring(
				0,
				50
			)}..."`
		);
		console.log(`   Should execute: ${response.shouldRunAgent}`);

		// Merge state updates (without apiKey)
		// But ensure apiKey is available for graph execution (from request or env)
		let updatedState = { 
			...sanitizedState, 
			...response.stateUpdates,
			apiKey: apiKeyToUse // Ensure apiKey is available for nodes during execution
		};

		// Emit intent event
		if (stream) {
			res.write(
				`event: intent\ndata: ${JSON.stringify({
					assistantMessage: response.assistantMessage,
					assistantMessages: response.assistantMessages, // Include separate messages if available
					shouldRunAgent: response.shouldRunAgent,
					stateUpdates: response.stateUpdates,
				})}\n\n`
			);
		}

		// Only execute graph if conversation handler says to
		if (response.shouldRunAgent) {
			console.log(`   🚀 Executing LangGraph...`);
			const config = { configurable: { thread_id: threadId } };

			if (stream) {
				// Stream graph execution
				const streamIterator = await graph.stream(
					updatedState,
					config
				);
				for await (const chunk of streamIterator) {
					// Send each state update as progress event
					res.write(
						`event: progress\ndata: ${JSON.stringify(
							chunk
						)}\n\n`
					);

					// Update local state tracker
					// Note: chunk is a partial state update, usually keyed by node name
					// e.g. { research: { ... } }
					const nodeName = Object.keys(chunk)[0];
					if (nodeName && chunk[nodeName]) {
						updatedState = {
							...updatedState,
							...chunk[nodeName],
						};
					}
				}
				// Get final state after stream completes to ensure we have everything
				const finalSnapshot = await graph.getState(config);
				updatedState = finalSnapshot.values as any;
			} else {
				// Standard execution
				const result = await graph.invoke(updatedState, config);
				updatedState = result;
			}
		} else {
			console.log(
				`   ⏸️  Skipping graph execution (conversation only)`
			);
		}

		console.log(`${'═'.repeat(70)}\n`);

		// Serialize state for transport (convert Sets to Arrays)
		// Remove apiKey and other unnecessary fields before sending
		const serializedState = {
			...updatedState,
			userProvidedFields: Array.from(
				updatedState.userProvidedFields || []
			),
			autoFillFields: Array.from(updatedState.autoFillFields || []),
		};
		// Ensure apiKey is not in serialized state
		delete serializedState.apiKey;

		if (
			serializedState.keywordCandidates &&
			serializedState.keywordCandidates.length > 0
		) {
			console.log(
				'🔍 [SERVER] Serialized keywordCandidates (first item):',
				serializedState.keywordCandidates[0]
			);
		} else {
			console.log(
				'🔍 [SERVER] No keywordCandidates in serialized state'
			);
		}

		if (stream) {
			res.write(
				`event: done\ndata: ${JSON.stringify({
					assistantMessage: response.assistantMessage,
					state: serializedState,
					executed: response.shouldRunAgent,
				})}\n\n`
			);
			res.end();
		} else {
			return res.json({
				assistantMessage: response.assistantMessage,
				state: serializedState,
				executed: response.shouldRunAgent,
			});
		}
		
		// ✨ Save agent history to database
		if (userId) {
			// Convert LangChain messages to simple format
			const langchainMessages = (updatedState.messages || []).map((msg: any) => ({
				role: msg._getType ? msg._getType() : (msg.role || 'assistant'),
				content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
				timestamp: Date.now()
			}));

			// Build complete message history including current exchange
			const completeMessages = [
				...langchainMessages,
				// Add current user message
				{
					role: 'user',
					content: message,
					timestamp: Date.now()
				},
				// Add assistant response if available
				...(response.assistantMessage ? [{
					role: 'assistant',
					content: response.assistantMessage,
					timestamp: Date.now()
				}] : [])
			];

			console.log(`💾 [History] Saving ${completeMessages.length} messages for thread: ${threadId}`);

			await saveAgentHistory({
				threadId,
				userId,
				messages: completeMessages,
				agentState: updatedState,
				topic: updatedState.data?.topic,
				blogGenerated: updatedState.finalBlogGenerated
			});
		}
		
		// Save blog if complete
		await saveBlogIfComplete(updatedState, threadId, userId);
	} catch (error: any) {
		console.error(`   ❌ Message processing failed:`, error);
		console.log(`${'═'.repeat(70)}\n`);

		// Check if it's a rate limit error
		const isRateLimit =
			error?.status === 429 ||
			error?.error?.code === 429 ||
			error?.error?.status === 'RESOURCE_EXHAUSTED' ||
			(error?.message &&
				/quota|rate limit|429/i.test(error.message));

		let errorMessage = error.message || 'Message processing failed';
		let statusCode = 500;

		if (isRateLimit) {
			// Extract retry delay from error
			let retryDelay: number | null = null;
			if (error?.error?.details) {
				for (const detail of error.error.details) {
					if (
						detail['@type'] ===
						'type.googleapis.com/google.rpc.RetryInfo'
					) {
						const delay = detail.retryDelay;
						if (delay) {
							retryDelay = parseFloat(delay) * 1000; // Convert to milliseconds
						}
					}
				}
			}

			// Create user-friendly error message
			if (retryDelay) {
				const seconds = Math.ceil(retryDelay / 1000);
				errorMessage = `Rate limit exceeded. Please wait ${seconds} seconds before trying again. The system will automatically retry.`;
			} else {
				errorMessage =
					'Rate limit exceeded. Please wait a moment and try again.';
			}
			statusCode = 429;
		}

		if (stream) {
			res.write(
				`event: error\ndata: ${JSON.stringify({
					error: errorMessage,
					isRateLimit,
					retryDelay: isRateLimit ? retryDelay : undefined,
				})}\n\n`
			);
			res.end();
		} else {
			return res.status(statusCode).json({
				error: errorMessage,
				isRateLimit,
				retryDelay: isRateLimit ? retryDelay : undefined,
			});
		}
	}
});

// Execute the agent and return results
app.post('/api/agent/invoke', async (req, res) => {
	const { state, threadId } = req.body || {};

	console.log(`\\n${'═'.repeat(70)}`);
	console.log(`🤖 [AGENT] Invoke Request Received`);
	console.log(`${'═'.repeat(70)}`);
	console.log(`   Thread ID: ${threadId}`);
	console.log(`   Has State: ${!!state}`);

	if (!threadId) {
		return res.status(400).json({ error: 'threadId is required' });
	}

	try {
		const config = { configurable: { thread_id: threadId } };
		const result = await graph.invoke(state, config);

		console.log(`   ✅ Agent execution complete`);
		console.log(`${'═'.repeat(70)}\\n`);

		return res.json({ state: result });
	} catch (error: any) {
		console.error(`   ❌ Agent execution failed:`, error);
		console.log(`${'═'.repeat(70)}\\n`);
		return res.status(500).json({
			error: error.message || 'Agent execution failed',
		});
	}
});

// Stream agent execution with Server-Sent Events
app.post('/api/agent/stream', async (req, res) => {
	const { state, threadId } = req.body || {};

	console.log(`\\n${'═'.repeat(70)}`);
	console.log(`🤖 [AGENT] Stream Request Received`);
	console.log(`${'═'.repeat(70)}`);
	console.log(`   Thread ID: ${threadId}`);

	if (!threadId) {
		return res.status(400).json({ error: 'threadId is required' });
	}

	// Set up SSE headers
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	try {
		const config = { configurable: { thread_id: threadId } };
		const stream = await graph.stream(state, config);

		for await (const chunk of stream) {
			// Send each state update as SSE event
			res.write(`data: ${JSON.stringify(chunk)}\\n\\n`);
		}

		res.write('event: done\\ndata: {}\\n\\n');
		res.end();

		console.log(`   ✅ Stream complete`);
		console.log(`${'═'.repeat(70)}\\n`);
	} catch (error: any) {
		console.error(`   ❌ Stream failed:`, error);
		res.write(
			`event: error\\ndata: ${JSON.stringify({
				error: error.message,
			})}\\n\\n`
		);
		res.end();
		console.log(`${'═'.repeat(70)}\\n`);
	}
});

// Get current agent state
app.get('/api/agent/state/:threadId', async (req, res) => {
	const { threadId } = req.params;

	try {
		const config = { configurable: { thread_id: threadId } };
		const snapshot = await graph.getState(config);

		return res.json({ state: snapshot.values });
	} catch (error: any) {
		console.error(`Failed to get state for thread ${threadId}:`, error);
		return res.status(500).json({ error: error.message });
	}
});

// Reset/delete agent state
app.delete('/api/agent/state/:threadId', async (req, res) => {
	const { threadId } = req.params;

	try {
		await checkpointer.deleteThread(threadId);
		return res.json({ success: true });
	} catch (error: any) {
		console.error(`Failed to delete thread ${threadId}:`, error);
		return res.status(500).json({ error: error.message });
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 📜 Agent History API Endpoints
// ═══════════════════════════════════════════════════════════════════════

import { getUserHistory, getHistoryThread, deleteHistory } from './db/agentHistoryService.js';

// Get user's conversation history list
app.get('/api/agent/history', optionalAuth, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		return res.status(401).json({ error: 'Authentication required' });
	}

	const { limit, offset, status } = req.query;
	
	try {
		const history = await getUserHistory(userId, {
			limit: limit ? parseInt(limit as string) : 20,
			offset: offset ? parseInt(offset as string) : 0,
			status: status as string
		});
		
		res.json({ history, count: history.length });
	} catch (error: any) {
		console.error('Failed to get history:', error);
		res.status(500).json({ error: error.message });
	}
});

// Get full conversation thread
app.get('/api/agent/history/:threadId', optionalAuth, async (req, res) => {
	const { threadId } = req.params;
	const userId = req.userId;
	
	if (!userId) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	
	try {
		const thread = await getHistoryThread(threadId);
		
		if (!thread) {
			return res.status(404).json({ error: 'Thread not found' });
		}
		
		// Check ownership
		if (thread.userId !== userId) {
			return res.status(403).json({ error: 'Access denied' });
		}
		
		res.json({ thread });
	} catch (error: any) {
		console.error('Failed to get thread:', error);
		res.status(500).json({ error: error.message });
	}
});

// Delete conversation history
app.delete('/api/agent/history/:threadId', optionalAuth, async (req, res) => {
	const { threadId } = req.params;
	const userId = req.userId;
	
	if (!userId) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	
	try {
		const thread = await getHistoryThread(threadId);
		
		if (!thread || thread.userId !== userId) {
			return res.status(403).json({ error: 'Access denied' });
		}
		
		await deleteHistory(threadId);
		res.json({ success: true });
	} catch (error: any) {
		console.error('Failed to delete history:', error);
		res.status(500).json({ error: error.message });
	}
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Keyword API listening on http://localhost:${PORT}`);
});
