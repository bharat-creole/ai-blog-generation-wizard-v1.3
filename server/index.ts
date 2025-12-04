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
	const { seed, urls, location } = req.body || {};

	// Support both URL-based and keyword-based requests
	const hasUrls = urls && Array.isArray(urls) && urls.length > 0;
	const hasSeed = seed && typeof seed === 'string';

	if (!hasUrls && !hasSeed) {
		return res.status(400).json({
			error: 'Missing required field: either "seed" (string) or "urls" (array) must be provided',
		});
	}

	const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
	const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
	const hasOAuthCreds = !!(
		process.env.CLIENT_ID &&
		process.env.CLIENT_SECRET &&
		process.env.REFRESH_TOKEN
	);

	if (!customerId || !developerToken || !hasOAuthCreds) {
		// Fallback simulation if credentials not configured
		if (hasSeed) {
			return res.status(503).json({
				error: 'Google Ads REST API credentials not configured',
				rows: simulateIdeas(seed),
			});
		} else {
			return res.status(503).json({
				error: 'Google Ads REST API credentials not configured',
				rows: [],
			});
		}
	}

	const apiUrl = `https://googleads.googleapis.com/v21/customers/${customerId}:generateKeywordIdeas`;
	const accessToken = await tokenManager.getValidToken();

	// If URLs provided, process each URL separately and aggregate results
	if (hasUrls) {
		const allRows: any[] = [];

		for (let i = 0; i < urls.length; i++) {
			const urlToProcess = urls[i];
			console.log(
				`   🔗 Processing URL ${i + 1}/${
					urls.length
				}: ${urlToProcess}`
			);

			try {
				const body: any = {
					customerId: customerId,
					includeAdultKeywords: false,
					keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
					urlSeed: {
						url: urlToProcess,
					},
					pageSize: 20, // Limit to 20 results per URL
				};

				// For primary keyword generation, only use URLs (no keyword seed)
				// This ensures keywords come directly from the URL content

				const response = await fetch(apiUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'developer-token': developerToken,
						Authorization: `Bearer ${accessToken}`,
					},
					body: JSON.stringify(body),
				});

				const data: any = await response.json();

				if (
					response.ok &&
					data.results &&
					data.results.length > 0
				) {
					const rows = data.results
						.map((result: any) => {
							const metrics =
								result.keywordIdeaMetrics || {};
							const text = result.text || '';
							const volume =
								metrics.avgMonthlySearches || 0;

							// Map competition to difficulty (0..1)
							let difficulty = 0.5;
							if (
								metrics.competitionIndex !==
								undefined
							) {
								difficulty =
									metrics.competitionIndex /
									100;
							} else if (metrics.competition) {
								const compMap: Record<
									string,
									number
								> = {
									LOW: 0.25,
									MEDIUM: 0.5,
									HIGH: 0.75,
								};
								difficulty =
									compMap[
										metrics.competition
									] || 0.5;
							}

							return {
								text,
								volume: Number(volume) || 0,
								difficulty,
							};
						})
						.filter((kw: any) => kw.text.trim() !== '');

					console.log(
						`   ✅ Got ${
							rows.length
						} keywords from URL ${i + 1}`
					);
					allRows.push(...rows);
				} else {
					console.log(`   ⚠️ No results from URL ${i + 1}`);
				}
			} catch (err: any) {
				console.error(
					`   ❌ Error processing URL ${i + 1}:`,
					err?.message || err
				);
			}
		}

		// Deduplicate by keyword text
		const uniqueRows = Array.from(
			new Map(
				allRows.map((row) => [row.text.toLowerCase(), row])
			).values()
		);

		console.log(
			`   ✅ Total unique keywords from all URLs: ${uniqueRows.length}`
		);
		return res.json({ rows: uniqueRows });
	}

	// If only seed provided (no URLs), use keywordSeed
	if (hasSeed) {
		const body = {
			customerId: customerId,
			includeAdultKeywords: false,
			keywordPlanNetwork: 'GOOGLE_SEARCH_AND_PARTNERS',
			keywordSeed: {
				keywords: [seed],
			},
			pageSize: 100,
		};

		try {
			const response = await fetch(apiUrl, {
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
						const metrics =
							result.keywordIdeaMetrics || {};
						const text = result.text || '';
						const volume =
							metrics.avgMonthlySearches || 0;

						// Map competition to difficulty (0..1)
						let difficulty = 0.5;
						if (
							metrics.competitionIndex !== undefined
						) {
							difficulty =
								metrics.competitionIndex / 100;
						} else if (metrics.competition) {
							const compMap: Record<
								string,
								number
							> = {
								LOW: 0.25,
								MEDIUM: 0.5,
								HIGH: 0.75,
							};
							difficulty =
								compMap[metrics.competition] ||
								0.5;
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
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 🤖 LangGraph Agent API Endpoints
// ═══════════════════════════════════════════════════════════════════════

import { graph, checkpointer } from './agent/graph.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { processMessage } from './agent/conversationHandler.js';
import { PrimaryAgent } from './agent/primaryAgent.js';
import { ContextManagerAgent } from './agent/contextManagerAgent.js';
import { AgentState } from './agent/state.js';

/**
 * Helper to persist messages to checkpointer
 * Ensures all conversation history is stored for future queries
 * IMPORTANT: Loads latest messages from checkpointer first to avoid losing history
 */
const persistMessagesToCheckpointer = async (
	threadId: string,
	state: Partial<AgentState>,
	assistantMessage: string,
	apiKey: string
): Promise<void> => {
	if (!threadId) return;

	try {
		const config = { configurable: { thread_id: threadId } };

		// Step 1: Load FULL existing checkpoint state (not just messages)
		let existingCheckpointState: any = null;
		try {
			// Try to get checkpoint tuple first to check if it exists
			const tuple = await checkpointer.getTuple(config);
			if (
				tuple &&
				tuple.checkpoint &&
				tuple.checkpoint.channel_values
			) {
				existingCheckpointState =
					tuple.checkpoint.channel_values;
				console.log(
					`   💾 Found existing checkpoint with ${
						existingCheckpointState.messages?.length ||
						0
					} messages`
				);
			}
		} catch (err: any) {
			// Handle case where checkpoint doesn't exist yet (new thread) - this is normal
			if (
				err?.message?.includes('messages') ||
				err?.message?.includes('undefined') ||
				err?.code === 'ENOENT' ||
				!err
			) {
				// Silent - new thread, no checkpoint yet
			} else {
				console.log(
					`   ⚠️ Could not load existing checkpoint:`,
					err?.message || err
				);
			}
		}

		// Step 2: Build complete message history
		const existingMessages = existingCheckpointState?.messages || [];
		const stateMessages = state.messages || [];

		// Helper to safely extract message content
		// Handles both LangChain serialized format and plain format
		const getMessageContent = (m: any): string => {
			if (!m) return '';

			// Handle LangChain serialized format (from checkpointer)
			if (m.kwargs && m.kwargs.content) {
				return m.kwargs.content;
			}

			// Handle plain LangChain message format
			if (typeof m.content === 'string') return m.content;
			if (m.content?.text) return m.content.text;

			// Handle frontend format {role, content}
			if (m.role && typeof m.content === 'string') return m.content;

			// Fallback
			if (m.content) return JSON.stringify(m.content);
			return '';
		};

		// Create a set of existing message contents to avoid duplicates
		const existingContents = new Set(
			existingMessages
				.map((m: any) => {
					const content = getMessageContent(m);
					return content
						? content.toLowerCase().trim()
						: '';
				})
				.filter((c: string) => c.length > 0) // Only include non-empty content
		);

		// Add new messages from state that don't exist in checkpointer
		const newMessagesFromState = stateMessages.filter((m: any) => {
			const content = getMessageContent(m);
			if (!content || content.length === 0) return false; // Skip empty messages
			return !existingContents.has(content.toLowerCase().trim());
		});

		// Step 3: Add new assistant message
		const assistantMsg = new AIMessage(assistantMessage);
		const assistantContent = assistantMessage.toLowerCase().trim();
		const assistantExists = existingMessages.some((m: any) => {
			const content = getMessageContent(m);
			return (
				content &&
				content.toLowerCase().trim() === assistantContent
			);
		});

		// Combine all messages - preserve order: existing + new from state + new assistant
		let allMessages = [...existingMessages];
		if (newMessagesFromState.length > 0) {
			allMessages = [...allMessages, ...newMessagesFromState];
		}
		if (!assistantExists) {
			allMessages = [...allMessages, assistantMsg];
		}

		// Step 4: Deep merge with existing checkpoint state to preserve ALL fields
		// This ensures we don't lose any data when saving
		const stateToPersist: any = {
			// Start with existing checkpoint (preserves all existing fields)
			...(existingCheckpointState || {}),
			// Deep merge data object if it exists
			data: {
				...(existingCheckpointState?.data || {}),
				...(state.data || {}),
			},
			// Merge preferences
			preferences: {
				...(existingCheckpointState?.preferences || {}),
				...(state.preferences || {}),
			},
			// Merge progress
			progress: {
				...(existingCheckpointState?.progress || {}),
				...(state.progress || {}),
			},
			// Overwrite with new state updates (but preserve existing if not in new state)
			...state,
			// Use merged messages (most important - preserves all history)
			messages: allMessages,
		};

		// IMPORTANT: Remove apiKey before persisting (security)
		delete stateToPersist.apiKey;

		console.log(
			`   💾 Persisting ${allMessages.length} total messages (${
				existingMessages.length
			} existing + ${newMessagesFromState.length} from state + ${
				assistantExists ? '0' : '1'
			} assistant)`
		);

		// Step 5: Create proper Checkpoint structure
		// Get existing checkpoint ID or generate new one
		let checkpointId = 'checkpoint-' + Date.now();
		try {
			const tuple = await checkpointer.getTuple(config);
			if (tuple?.checkpoint?.id) {
				checkpointId = tuple.checkpoint.id;
			}
		} catch (err) {
			// New checkpoint, use generated ID
		}

		// Create checkpoint object with proper structure
		const checkpoint = {
			id: checkpointId,
			ts: new Date().toISOString(),
			channel_values: stateToPersist,
			channel_versions: {},
			versions_seen: {},
		};

		// Step 6: Persist using checkpointer
		await checkpointer.put(config, checkpoint, {});
		console.log(
			`   💾 Persisted ${
				allMessages.length
			} messages to checkpointer (${
				newMessagesFromState.length
			} new from state, ${
				assistantExists
					? 'assistant already exists'
					: 'added assistant'
			})`
		);
	} catch (err) {
		console.log(
			`   ⚠️ Could not persist messages to checkpointer:`,
			err
		);
	}
};

// NEW: Main conversation endpoint - handles user messages with intent classification
app.post('/api/agent/message', async (req, res) => {
	const {
		message,
		threadId,
		currentState,
		apiKey, // Extract apiKey from request body, not from state
		stream = false,
	} = req.body || {};

	console.log(`\n${'═'.repeat(70)}`);
	console.log(
		`💬 [AGENT] Message Request Received ${stream ? '(Streaming)' : ''}`
	);
	console.log(`${'═'.repeat(70)}`);
	console.log(`   Thread ID: ${threadId}`);
	console.log(`   Message: "${message}"`);

	if (!threadId || !message) {
		return res.status(400).json({
			error: 'threadId and message are required',
		});
	}

	// Get apiKey from request body, state, or environment variable (in that order)
	const apiKeyToUse =
		apiKey || currentState?.apiKey || process.env.GEMINI_API_KEY;
	if (!apiKeyToUse) {
		return res.status(400).json({
			error: 'apiKey is required. Please provide apiKey in request, state, or set GEMINI_API_KEY in your .env.local file.',
		});
	}

	// Remove apiKey from state to prevent storing it
	const sanitizedState = { ...currentState };
	delete sanitizedState.apiKey;

	// Helper to convert frontend message format to LangChain format
	const convertToLangChainMessage = (m: any): HumanMessage | AIMessage => {
		// If already a LangChain message, return as is
		if (m._getType || m.constructor?.name?.includes('Message')) {
			return m;
		}

		// Convert frontend format {role, content} to LangChain format
		if (m.role === 'user' || m.role === 'human') {
			return new HumanMessage(m.content || '');
		} else if (m.role === 'assistant' || m.role === 'ai') {
			return new AIMessage(m.content || '');
		}

		// Fallback: try to extract content
		const content =
			typeof m.content === 'string'
				? m.content
				: m.content?.text || JSON.stringify(m.content);
		return new HumanMessage(content);
	};

	// Helper to extract message content for comparison
	const getMessageContent = (m: any): string => {
		if (typeof m.content === 'string') return m.content;
		if (m.content?.text) return m.content.text;
		if (m.content) return JSON.stringify(m.content);
		return '';
	};

	// Step 1: Get messages from checkpointer (most reliable source)
	let allMessages: (HumanMessage | AIMessage)[] = [];
	if (threadId) {
		try {
			const config = { configurable: { thread_id: threadId } };
			// Try to get checkpoint tuple first to check if it exists
			const tuple = await checkpointer.getTuple(config);
			if (
				tuple &&
				tuple.checkpoint &&
				tuple.checkpoint.channel_values
			) {
				const checkpointState = tuple.checkpoint.channel_values;
				// Check if checkpoint has messages
				if (
					checkpointState.messages &&
					Array.isArray(checkpointState.messages) &&
					checkpointState.messages.length > 0
				) {
					allMessages = checkpointState.messages.map(
						convertToLangChainMessage
					);
					console.log(
						`   📚 Loaded ${allMessages.length} messages from checkpointer`
					);
				}
			}
		} catch (err: any) {
			// Handle case where checkpoint doesn't exist yet (new thread) - this is normal
			if (
				err?.message?.includes('messages') ||
				err?.message?.includes('undefined') ||
				err?.code === 'ENOENT' ||
				!err
			) {
				// Silent - new thread, no checkpoint yet
			} else {
				console.log(
					`   ⚠️ Could not load messages from checkpointer:`,
					err?.message || err
				);
			}
		}
	}

	// Step 2: Convert and merge frontend messages
	console.log(
		`   📨 Frontend sent ${
			currentState?.messages?.length || 0
		} messages in currentState`
	);
	if (currentState?.messages && Array.isArray(currentState.messages)) {
		const frontendMessages = currentState.messages.map(
			convertToLangChainMessage
		);

		// Create a set of existing message contents to avoid duplicates
		const existingContents = new Set(
			allMessages.map((m) =>
				getMessageContent(m).toLowerCase().trim()
			)
		);

		// Add new messages that don't already exist (case-insensitive comparison)
		const newMessages = frontendMessages.filter((m) => {
			const content = getMessageContent(m).toLowerCase().trim();
			return (
				content &&
				content.length > 0 &&
				!existingContents.has(content)
			);
		});

		if (newMessages.length > 0) {
			allMessages = [...allMessages, ...newMessages];
			console.log(
				`   📚 Added ${newMessages.length} new messages from frontend (total: ${allMessages.length})`
			);
		} else {
			console.log(
				`   📚 No new messages from frontend (all already in checkpointer)`
			);
		}
	}

	// Step 3: Add current user message (if not already there)
	const currentUserMessage = new HumanMessage(message);
	const userMessageContent = getMessageContent(currentUserMessage);
	const userMessageExists = allMessages.some(
		(m) => getMessageContent(m) === userMessageContent
	);

	if (!userMessageExists) {
		allMessages = [...allMessages, currentUserMessage];
		console.log(
			`   💬 Added current user message (total: ${allMessages.length})`
		);
	}

	// Update sanitizedState with properly formatted messages
	sanitizedState.messages = allMessages;

	// Setup streaming if requested
	if (stream) {
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');
		res.flushHeaders();
	}

	try {
		// 1️⃣ PRIMARY ROUTER (stateless)
		console.log(`   🛡️ Running Primary Agent...`);
		const primaryAgent = new PrimaryAgent(apiKeyToUse);
		const routing = await primaryAgent.analyzeMessage(
			message,
			sanitizedState
		);

		// If router says: don't proceed (abort) and we have a direct response → return it.
		if (!routing.shouldProceed) {
			console.log(`   ⛔ Primary Agent blocked: ${routing.type}`);
			console.log(
				`   Direct Response: "${
					routing.directResponse || 'NOT PROVIDED'
				}"`
			);

			// Generate fallback response based on type if directResponse is missing
			let fallbackMessage =
				"I'm here to help you create blog posts. Please share a topic to get started.";
			if (!routing.directResponse) {
				switch (routing.type) {
					case 'irrelevant_small_talk':
						fallbackMessage =
							"Hi! I'm here to help you create blog posts. What topic would you like to write about?";
						break;
					case 'general_question':
						fallbackMessage =
							"I help you create SEO-optimized blog posts. Just tell me a topic and I'll guide you through keyword research, title generation, and content creation!";
						break;
					case 'off_topic':
						fallbackMessage =
							"I'm focused on helping you create blog content. What topic would you like to write about?";
						break;
					case 'abusive_or_invalid':
						fallbackMessage =
							"I couldn't understand your message. Please provide a clear blog topic to get started.";
						break;
				}
			}

			const assistantResponse =
				routing.directResponse || fallbackMessage;
			const blockedResponse = {
				assistantMessage: assistantResponse,
				stateUpdates: {},
				shouldRunAgent: false,
			};

			// Persist messages to checkpointer so they're available for next query
			await persistMessagesToCheckpointer(
				threadId,
				sanitizedState,
				assistantResponse,
				apiKeyToUse
			);

			console.log(
				`   📤 Sending blocked response: "${blockedResponse.assistantMessage.substring(
					0,
					50
				)}..."`
			);

			if (stream) {
				try {
					// Send intent event with the response
					res.write(
						`event: intent\ndata: ${JSON.stringify(
							blockedResponse
						)}\n\n`
					);
					// Send done event with state (frontend expects state in onComplete)
					res.write(
						`event: done\ndata: ${JSON.stringify({
							assistantMessage:
								blockedResponse.assistantMessage,
							state: sanitizedState, // Include current state
							executed: false, // No graph execution
						})}\n\n`
					);
					res.end();
					return;
				} catch (streamError) {
					console.error('❌ [STREAM ERROR]', streamError);
					// Fallback to non-streaming if streaming fails
					return res.json(blockedResponse);
				}
			}

			return res.json(blockedResponse);
		}

		// 2️⃣ Handle meta instructions like restart
		if (routing.systemAction === 'restart') {
			console.log(`   🔄 Primary Agent: Restart requested`);
			// Clear all blog-related state except messages
			const resetState: Partial<typeof sanitizedState> = {
				...sanitizedState,
				data: {} as any,
				outline: [],
				draft: '',
				currentStep: 'topic',
				halt: null,
				progress: { sectionIndex: 0 },
				outlineApproved: false,
			};

			const restartMessage =
				"Okay, let's start fresh. Tell me the topic you want to write about.";
			const restartResponse = {
				assistantMessage: restartMessage,
				stateUpdates: resetState,
				shouldRunAgent: false,
			};

			// Persist restart message to checkpointer
			await persistMessagesToCheckpointer(
				threadId,
				{ ...sanitizedState, ...resetState },
				restartMessage,
				apiKeyToUse
			);

			if (stream) {
				try {
					// Send intent event with the response
					res.write(
						`event: intent\ndata: ${JSON.stringify(
							restartResponse
						)}\n\n`
					);
					// Send done event with state (frontend expects state in onComplete)
					res.write(
						`event: done\ndata: ${JSON.stringify({
							assistantMessage:
								restartResponse.assistantMessage,
							state: sanitizedState, // Include current state
							executed: false, // No graph execution
						})}\n\n`
					);
					res.end();
					return;
				} catch (streamError) {
					console.error('❌ [STREAM ERROR]', streamError);
					// Fallback to non-streaming if streaming fails
					return res.json(restartResponse);
				}
			}

			return res.json(restartResponse);
		}

		// 3️⃣ CONTEXT QUERY → Context Manager Agent (NO LangGraph)
		if (routing.systemAction === 'route_to_context_manager') {
			console.log(`   📚 Routing to Context Manager...`);
			console.log(
				`   📚 Total messages available: ${sanitizedState.messages.length}`
			);

			const contextAgent = new ContextManagerAgent(apiKeyToUse);
			const ctxResponse = await contextAgent.handleContextQuery(
				routing.normalizedMessage || message,
				sanitizedState // sanitizedState already has all merged messages from start
			);

			// Persist assistant response to checkpointer
			await persistMessagesToCheckpointer(
				threadId,
				sanitizedState,
				ctxResponse.assistantMessage,
				apiKeyToUse
			);

			const contextResponse = {
				assistantMessage: ctxResponse.assistantMessage,
				stateUpdates: {}, // optionally append this answer to messages in frontend
				shouldRunAgent: false,
			};

			console.log(
				`   📤 Sending context response: "${ctxResponse.assistantMessage.substring(
					0,
					50
				)}..."`
			);

			if (stream) {
				try {
					// Send intent event with the response
					res.write(
						`event: intent\ndata: ${JSON.stringify(
							contextResponse
						)}\n\n`
					);
					// Send done event with state (frontend expects state in onComplete)
					res.write(
						`event: done\ndata: ${JSON.stringify({
							assistantMessage:
								ctxResponse.assistantMessage,
							state: sanitizedState, // Include current state
							executed: false, // No graph execution
						})}\n\n`
					);
					res.end();
					return;
				} catch (streamError) {
					console.error('❌ [STREAM ERROR]', streamError);
					// Fallback to non-streaming if streaming fails
					return res.json(contextResponse);
				}
			}

			return res.json(contextResponse);
		}

		// 4️⃣ NORMAL BLOG FLOW → Intent Classifier + Conversation Handler + LangGraph
		console.log(`   📝 Processing through Conversation Handler...`);
		// Use normalized message for intent classification
		const normalized = routing.normalizedMessage || message;
		const response = await processMessage(
			normalized,
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
			apiKey: apiKeyToUse, // Ensure apiKey is available for nodes during execution
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
			// IMPORTANT: Persist assistant message even when not running graph
			await persistMessagesToCheckpointer(
				threadId,
				updatedState,
				response.assistantMessage,
				apiKeyToUse
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

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Keyword API listening on http://localhost:${PORT}`);
});
