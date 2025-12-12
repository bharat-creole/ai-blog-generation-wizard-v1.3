/**
 * Primary Agent - Mediator & Controller
 *
 * Acts as the main controller between user and lang-graph agent.
 * - Understands user queries and intent
 * - Detects regeneration requests
 * - Updates state to direct lang-graph execution
 * - Reframes lang-graph responses to be user-friendly
 */

import { GoogleGenAI, Type } from '@google/genai';
import { AgentState } from './state';

export type PrimaryMessageType =
	| 'blog_creation_request'
	| 'meta_instruction'
	| 'context_query'
	| 'general_question'
	| 'off_topic'
	| 'abusive_or_invalid'
	| 'irrelevant_small_talk'
	| 'regeneration_request'; // NEW: User wants to regenerate something

export type PrimarySystemAction =
	| 'restart' // reset flow
	| 'abort' // do not go to intent classifier / graph
	| 'route_to_intent_classifier' // normal blog flow
	| 'route_to_context_manager' // handle via Context Manager
	| 'regenerate_node'; // NEW: Re-run a specific node

export interface RegenerationRequest {
	targetNode:
		| 'title_generation'
		| 'research_primary'
		| 'research_secondary'
		| 'discover'
		| 'proposal'
		| null;
	feedback?: string; // User feedback for regeneration
	clearPrevious?: boolean; // Whether to clear previous results
}

export interface PrimaryAgentResponse {
	type: PrimaryMessageType;
	normalizedMessage: string;
	shouldProceed: boolean; // should we continue into blog/intent pipeline?
	systemAction: PrimarySystemAction;
	directResponse?: string; // used when aborting or answering directly
	regenerationRequest?: RegenerationRequest; // NEW: For regeneration requests
	stateUpdates?: Partial<AgentState>; // NEW: State updates to direct lang-graph
}

export class PrimaryAgent {
	private ai: GoogleGenAI;

	constructor(private apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	/**
	 * Analyze user message and decide routing.
	 * Enhanced to understand regeneration requests and update state accordingly.
	 */
	async analyzeMessage(
		userMessage: string,
		currentState: AgentState
	): Promise<PrimaryAgentResponse> {
		// Determine what information has been collected
		const hasTopic = !!currentState.data?.topic?.trim();
		const hasPrimaryKeyword =
			!!currentState.data?.primaryKeyword?.trim();
		const hasSecondaryKeywords = !!(
			currentState.data?.secondaryKeywords?.length > 0
		);
		const hasTitle = !!currentState.data?.title?.trim();
		const hasOutline = currentState.outline?.length > 0;
		const isFirstMessage =
			!currentState.messages || currentState.messages.length <= 1;

		// Determine missing information
		const missingInfo: string[] = [];
		if (!hasTopic) missingInfo.push('topic');
		if (!hasPrimaryKeyword) missingInfo.push('primary keyword');
		if (!hasSecondaryKeywords) missingInfo.push('secondary keywords');
		if (!hasTitle) missingInfo.push('title');

		// Determine what step we're about to execute
		const currentStep = currentState.currentStep || 'topic';
		const isAboutToResearchPrimary =
			currentStep === 'topic' && hasTopic && !hasPrimaryKeyword;
		const isAboutToResearchSecondary =
			currentStep === 'primary_keyword' &&
			hasPrimaryKeyword &&
			!hasSecondaryKeywords;
		const isAboutToGenerateTitle =
			currentStep === 'secondary_keywords' &&
			hasSecondaryKeywords &&
			!hasTitle;

		// Check for automation mode
		const isFullAutomation =
			currentState.preferences?.automationLevel === 'full';
		const isGuidedMode =
			currentState.preferences?.automationLevel === 'guided' ||
			!currentState.preferences?.automationLevel;

		// Check for modification request
		const modificationRequest =
			currentState.conversationContext?.modificationRequest;

		const prompt = `
Act as a Primary Mediator Agent for a blog generation system. You control the conversation flow and direct the lang-graph agent with an INTERACTIVE, CONVERSATIONAL approach.

🎯 YOUR PRIMARY GOAL: Guide users through blog creation by:
1. Tracking what information has been collected
2. Identifying what's missing
3. Asking for missing information in a friendly, sequential manner
4. Keeping users on track (Topic → Keywords → Title → Outline → ...)
5. Handling automation requests with confirmations
6. Handling modifications immediately (like regeneration requests - no confirmation needed)

📋 INFORMATION STATUS:
- Topic: ${hasTopic ? `✅ "${currentState.data?.topic}"` : '❌ Missing'}
- Primary Keyword: ${
			hasPrimaryKeyword
				? `✅ "${currentState.data?.primaryKeyword}"`
				: '❌ Missing'
		}
- Secondary Keywords: ${
			hasSecondaryKeywords
				? `✅ ${currentState.data?.secondaryKeywords?.length} keywords`
				: '❌ Missing'
		}
- Title: ${hasTitle ? `✅ "${currentState.data?.title}"` : '❌ Missing'}
- Outline: ${hasOutline ? '✅ Generated' : '❌ Not generated'}
- Current Step: ${currentState.currentStep || 'none'}
- Halted Reason: ${currentState.halt?.reason || 'none'}
- Automation Mode: ${
			isFullAutomation ? 'Full' : isGuidedMode ? 'Guided' : 'Manual'
		}
- Is First Message: ${isFirstMessage}
- Modification Request: ${modificationRequest || 'none'}
- About to Research Primary: ${isAboutToResearchPrimary}
- About to Research Secondary: ${isAboutToResearchSecondary}
- About to Generate Title: ${isAboutToGenerateTitle}

📝 MISSING INFORMATION: ${
			missingInfo.length > 0
				? missingInfo.join(', ')
				: 'None - all required info collected'
		}

🔍 CLASSIFICATION RULES (PRIORITY ORDER):

1. **FIRST MESSAGE / GREETING** (HIGHEST PRIORITY)
   - If this is the first message OR user just says "hi", "hello", etc.
   - Type: "irrelevant_small_talk"
   - SystemAction: "abort"
   - shouldProceed: false
   - directResponse: "Great! I'll help you create a blog post. To get started, I'll need:\n- **Topic**: What would you like to write about?\n- **Primary Keyword**: The main SEO keyword (Let me present you some suggestions. If you would like to give of your own then please provide it.)\n- **Secondary Keywords**: Additional keywords (Let me present you some suggestions. If you would like to give of your own then please provide it.)\n- **Title**: Blog post title (I can generate options)\n- **Interlinking & References**: Optional, can add later\n\nPlease share your topic to begin!"

2. **AUTOMATION REQUEST** (SECOND HIGHEST PRIORITY)
   - Phrases: "generate blog by yourself", "handle it automatically", "you decide everything", "full auto", "automatic mode", "do it yourself"
   - Type: "blog_creation_request"
   - SystemAction: "route_to_intent_classifier"
   - shouldProceed: true
   - BUT: Set preferences.automationLevel to "full" in stateUpdates
   - directResponse: null (let lang-graph handle it, but add confirmation prompts later)

3. **MODIFICATION REQUEST** (THIRD PRIORITY)
   
   **CRITICAL: Handle modification requests immediately (like regeneration)**
   
   A. If user wants to modify (treat like regeneration request - proceed immediately):
      - Detect modification phrases: "change primary keyword", "I want to change primary keyword", "modify title", "change topic", "update keyword"
      - Type: "blog_creation_request"
      - SystemAction: "route_to_intent_classifier"
      - shouldProceed: true (CRITICAL: Proceed immediately, like regeneration)
      - directResponse: "Sure, I'll help you do that. You will have to redo some steps again for better blog generation."
      - Clear the field being modified and set currentStep to the appropriate step in stateUpdates
      - Set modificationRequest: "primary keyword" | "title" | "topic" | "secondary keywords" in stateUpdates (for tracking only)
      - IMPORTANT: Do NOT set awaitingConfirmation - proceed immediately like regeneration requests

4. **REGENERATION REQUEST**
   - "regenerate titles", "new keywords", "try again", "generate again"
   - Type: "regeneration_request"
   - SystemAction: "regenerate_node"
   - shouldProceed: true
   - Extract targetNode and feedback

5. **PARTIAL INFORMATION PROVIDED**
   - User gives topic, keyword, title, etc. (partially or fully)
   - Type: "blog_creation_request"
   - SystemAction: "route_to_intent_classifier"
   - shouldProceed: true
   - Analyze what was provided and what's missing
   - If missing info: directResponse should guide user (but still proceed to intent classifier)

6. **IRRELEVANT / OFF-TOPIC**
   - Questions not related to blog creation
   - Type: "off_topic"
   - SystemAction: "abort"
   - shouldProceed: false
   - directResponse: "I'm focused on helping you create blog content. ${
		missingInfo.length > 0
			? `We still need: ${missingInfo.join(', ')}. `
			: ''
   }What would you like to work on next?"

7. **CONTEXT QUERY**
   - User asking about previous conversation: "what did we discuss?", "what's my topic?"
   - Type: "context_query"
   - SystemAction: "route_to_context_manager"
   - shouldProceed: false

8. **GENERAL QUESTION**
   - "what can you do?", "how does this work?"
   - Type: "general_question"
   - SystemAction: "abort"
   - shouldProceed: false
   - directResponse: "I help you create SEO-optimized blog posts. I'll guide you through keyword research, title generation, and content creation. ${
		missingInfo.length > 0
			? `Currently, we need: ${missingInfo.join(', ')}. `
			: ''
   }What would you like to do?"

9. **RESTART REQUEST**
   - "start over", "reset", "begin again"
   - Type: "meta_instruction"
   - SystemAction: "restart"
   - shouldProceed: false

🎯 SCENARIO HANDLING:

**Scenario 1: User gives partial/full information**
- Analyze what was provided
- Validate for relevance
- Identify what's missing
- If missing info: Generate helpful directResponse asking for next step
- Still set shouldProceed: true to let intent classifier extract data
- Example: "✅ I've captured your topic: 'AI agents'. Next, I'll research primary keywords. Let me present you some suggestions. If you would like to give of your own then please provide it."

**Scenario 2: No information or irrelevant query**
- Type: "off_topic" or "irrelevant_small_talk"
- SystemAction: "abort"
- shouldProceed: false
- directResponse: Redirect to missing information
- Example: "I'm here to help with blog creation. ${
			missingInfo.length > 0
				? `We need: ${missingInfo.join(', ')}. `
				: ''
		}What topic would you like to write about?"

**Scenario 3: User asks for automation**
- Detect automation phrases
- Type: "blog_creation_request"
- SystemAction: "route_to_intent_classifier"
- shouldProceed: true
- Set preferences.automationLevel: "full" in stateUpdates
- After automation, lang-graph will ask: "Do you want to make any changes or would you like to proceed with this?"

**Scenario 4: User requests automation during guided flow**
- Same as Scenario 3
- Allow automation as requested
- Follow confirmation process

**Scenario 5: User asks to modify existing information**
- First, request confirmation
- Type: "blog_creation_request"
- SystemAction: "route_to_intent_classifier"
- shouldProceed: true
- directResponse: "⚠️ Modifying this will affect the blog generation flow. Are you sure? This may require regenerating dependent steps."

USER MESSAGE: "${userMessage}"

OUTPUT JSON FORMAT:
{
  "type": "blog_creation_request" | "regeneration_request" | "meta_instruction" | "context_query" | "general_question" | "off_topic" | "abusive_or_invalid" | "irrelevant_small_talk",
  "normalizedMessage": "cleaned message (remove greetings, keep core intent)",
  "shouldProceed": true | false,
  "systemAction": "restart" | "abort" | "route_to_intent_classifier" | "route_to_context_manager" | "regenerate_node",
  "directResponse": "Required if shouldProceed is false OR if you want to guide user before proceeding. Be conversational, friendly, and helpful! IMPORTANT: Use \\n for newlines in JSON strings. For lists, use single \\n between list items (not double). Use \\n\\n only before the list starts and before closing text. Example: 'Text:\\n\\n- Item 1\\n- Item 2\\n- Item 3\\n\\nClosing text'",
  "regenerationRequest": {
    "targetNode": "title_generation" | "research_primary" | "research_secondary" | "discover" | null,
    "feedback": "extracted feedback text if provided",
    "clearPrevious": true
  },
  "stateUpdates": {
    "preferences": { "automationLevel": "full" | "guided" | "manual" },
    // ... other state updates
  }
}

CRITICAL RULES:
- If shouldProceed is false, ALWAYS provide a helpful directResponse
- If shouldProceed is true but you want to guide user, you can still provide directResponse (it will be shown before proceeding)
- Be conversational and interactive - guide users step by step
- Always identify what's missing and ask for it
- Keep users on track - redirect irrelevant queries

EXAMPLES:

**First Message / Greeting:**
- "Hello" → {
    "type": "irrelevant_small_talk",
    "normalizedMessage": "hello",
    "shouldProceed": false,
    "systemAction": "abort",
    "directResponse": "Great! I'll help you create a blog post. To get started, I'll need:\n\n- **Topic**: What would you like to write about?\n- **Primary Keyword**: The main SEO keyword (Let me present you some suggestions. If you would like to give of your own then please provide it.)\n- **Secondary Keywords**: Additional keywords (Let me present you some suggestions. If you would like to give of your own then please provide it.)\n- **Title**: Blog post title (I can generate options)\n- **Interlinking & References**: Optional, can add later\n\nPlease share your topic to begin!"
  }

**User Provides Topic (Starting Research):**
- "I want to write about AI agents" (when isAboutToResearchPrimary is true) → {
    "type": "blog_creation_request",
    "normalizedMessage": "I want to write about AI agents",
    "shouldProceed": true,
    "systemAction": "route_to_intent_classifier",
    "directResponse": "✅ Great! I've captured your topic: 'AI agents'.\n\n🔍 **Researching primary keywords...**\n\nLet me present you some suggestions. If you would like to give of your own then please provide it."
  }

**When About to Research Secondary Keywords:**
- User provides primary keyword or we're about to research secondary (isAboutToResearchSecondary is true) → {
    "type": "blog_creation_request",
    "normalizedMessage": "[user message]",
    "shouldProceed": true,
    "systemAction": "route_to_intent_classifier",
    "directResponse": "✅ Got it! Now let me find some secondary keywords that complement your primary keyword.\n\n🔍 **Researching secondary keywords...**\n\nLet me present you some suggestions. If you would like to give of your own then please provide it."
  }

**When About to Generate Title:**
- User provides secondary keywords or we're about to generate title (isAboutToGenerateTitle is true) → {
    "type": "blog_creation_request",
    "normalizedMessage": "[user message]",
    "shouldProceed": true,
    "systemAction": "route_to_intent_classifier",
    "directResponse": "✅ Perfect! I've captured your secondary keywords.\n\n📝 **Generating title options...**\n\nI'm creating SEO-optimized title options that incorporate your keywords. This will just take a moment..."
  }

**Automation Request:**
- "Generate blog by yourself" → {
    "type": "blog_creation_request",
    "normalizedMessage": "generate blog by yourself",
    "shouldProceed": true,
    "systemAction": "route_to_intent_classifier",
    "stateUpdates": {
      "preferences": { "automationLevel": "full" }
    }
  }

**Modification Request (Proceed Immediately, Like Regeneration):**
- "I want to change primary keyword" → {
    "type": "blog_creation_request",
    "normalizedMessage": "I want to change primary keyword",
    "shouldProceed": true,
    "systemAction": "route_to_intent_classifier",
    "directResponse": "Sure, I'll help you do that. You will have to redo some steps again for better blog generation.",
    "stateUpdates": {
      "conversationContext": {
        "modificationRequest": "primary keyword",
        "lastIntent": "modification_request"
      },
      // CRITICAL: Clear the field being modified and reset to that step immediately
      "data": {
        "primaryKeyword": null, // Clear primary keyword
        "secondaryKeywords": [], // Clear dependent fields
        "title": null // Clear dependent fields
      },
      "currentStep": "primary_keyword", // Route to primary keyword research
      "halt": null, // Clear any halt to allow execution
      "outline": [], // Clear outline since it depends on keywords
      "outlineApproved": false,
      "draft": "" // Clear draft
    }
  }
  
  IMPORTANT: Based on modificationRequest value, clear the appropriate field immediately:
  - "primary keyword" → Clear primaryKeyword, secondaryKeywords, title, set currentStep: "primary_keyword"
  - "secondary keywords" → Clear secondaryKeywords, title, set currentStep: "secondary_keywords"
  - "title" → Clear title, set currentStep: "title"
  - "topic" → Clear topic, primaryKeyword, secondaryKeywords, title, set currentStep: "topic"
  
  CRITICAL: Modification requests should proceed immediately (shouldProceed: true) just like regeneration requests. No confirmation needed.

**Irrelevant Query:**
- "What's the weather?" → {
    "type": "off_topic",
    "normalizedMessage": "what's the weather",
    "shouldProceed": false,
    "systemAction": "abort",
    "directResponse": "I'm focused on helping you create blog content. We still need: topic, primary keyword, secondary keywords, title. What would you like to work on next?"
  }

**Regeneration:**
- "Regenerate titles with more focus on SEO" → {
    "type": "regeneration_request",
    "normalizedMessage": "regenerate titles with more focus on SEO",
    "shouldProceed": true,
    "systemAction": "regenerate_node",
    "regenerationRequest": {
      "targetNode": "title_generation",
      "feedback": "more focus on SEO",
      "clearPrevious": true
    }
  }
`;

		try {
			const responseSchema = {
				type: Type.OBJECT,
				properties: {
					type: {
						type: Type.STRING,
						enum: [
							'blog_creation_request',
							'regeneration_request',
							'meta_instruction',
							'context_query',
							'general_question',
							'off_topic',
							'abusive_or_invalid',
							'irrelevant_small_talk',
						],
					},
					normalizedMessage: { type: Type.STRING },
					shouldProceed: { type: Type.BOOLEAN },
					systemAction: {
						type: Type.STRING,
						enum: [
							'restart',
							'abort',
							'route_to_intent_classifier',
							'route_to_context_manager',
							'regenerate_node',
						],
					},
					directResponse: {
						type: Type.STRING,
						nullable: true,
					},
					regenerationRequest: {
						type: Type.OBJECT,
						nullable: true,
						properties: {
							targetNode: {
								type: Type.STRING,
								nullable: true,
								enum: [
									'title_generation',
									'research_primary',
									'research_secondary',
									'discover',
									null,
								],
							},
							feedback: {
								type: Type.STRING,
								nullable: true,
							},
							clearPrevious: { type: Type.BOOLEAN },
						},
					},
				},
				required: [
					'type',
					'normalizedMessage',
					'shouldProceed',
					'systemAction',
				],
			};

			const response = await this.ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: { parts: [{ text: prompt }] },
				config: {
					responseMimeType: 'application/json',
					responseSchema: responseSchema,
				},
			});

			// Extract text from response
			const text = this.extractTextFromResponse(response);
			const result = JSON.parse(text) as PrimaryAgentResponse;

			// Validate and ensure required fields
			if (!result.normalizedMessage && result.shouldProceed) {
				result.normalizedMessage = userMessage; // Fallback to original if missing
			}

			// ✨ Post-process directResponse to ensure proper markdown formatting
			// ReactMarkdown needs proper newline formatting to render line breaks correctly
			if (result.directResponse) {
				const originalResponse = result.directResponse;
				result.directResponse =
					this.normalizeMarkdownFormatting(
						result.directResponse
					);
				// Debug logging to track formatting issues
				if (originalResponse !== result.directResponse) {
					console.log(
						'   🔧 [FORMAT] Normalized directResponse formatting'
					);
					console.log(
						`   Original length: ${originalResponse.length}, New length: ${result.directResponse.length}`
					);
					console.log(
						`   Original has \\n: ${originalResponse.includes(
							'\\n'
						)}, New has \\n: ${result.directResponse.includes(
							'\\n'
						)}`
					);
					console.log(
						`   Original has actual newline: ${originalResponse.includes(
							'\n'
						)}, New has actual newline: ${result.directResponse.includes(
							'\n'
						)}`
					);
				}
			}

			// Post-process regeneration requests to ensure proper state updates
			if (
				result.type === 'regeneration_request' &&
				result.regenerationRequest
			) {
				result.stateUpdates =
					this.prepareRegenerationStateUpdates(
						result.regenerationRequest,
						currentState
					);
			}

			// ✨ NEW: Post-process modification requests to clear fields and route correctly
			// Modification requests should proceed immediately like regeneration requests
			if (
				result.type === 'blog_creation_request' &&
				modificationRequest
			) {
				// User requested modification - prepare state updates to clear fields and route immediately
				const modificationUpdates =
					this.prepareModificationStateUpdates(
						modificationRequest,
						currentState
					);
				// Merge with existing stateUpdates
				result.stateUpdates = {
					...result.stateUpdates,
					...modificationUpdates,
				};
				// Update directResponse if not already set
				if (!result.directResponse) {
					result.directResponse =
						"Sure, I'll help you do that. You will have to redo some steps again for better blog generation.";
				}
				result.shouldProceed = true; // Ensure we proceed
				result.systemAction = 'route_to_intent_classifier';
				console.log(
					`   🔄 [MODIFICATION REQUEST] Preparing state updates for: ${modificationRequest}`
				);
			}

			console.log('🛡️ [PRIMARY AGENT]', {
				type: result.type,
				action: result.systemAction,
				normalized: result.normalizedMessage || '(empty)',
				shouldProceed: result.shouldProceed,
				hasDirectResponse: !!result.directResponse,
				regenerationRequest: result.regenerationRequest,
				hasStateUpdates: !!result.stateUpdates,
			});

			return result;
		} catch (error) {
			console.error('❌ [PRIMARY AGENT] Error:', error);
			// Fallback: treat as normal blog creation request
			return {
				type: 'blog_creation_request',
				normalizedMessage: userMessage,
				shouldProceed: true,
				systemAction: 'route_to_intent_classifier',
			};
		}
	}

	/**
	 * Prepare state updates for regeneration requests
	 */
	private prepareRegenerationStateUpdates(
		regenerationRequest: RegenerationRequest,
		currentState: AgentState
	): Partial<AgentState> {
		const updates: Partial<AgentState> = {};

		switch (regenerationRequest.targetNode) {
			case 'title_generation':
				updates.titleSelected = false;
				updates.titleOptions = [];
				updates.data = {
					...currentState.data,
					title: undefined, // Clear current title
				};
				// Store feedback if provided
				if (regenerationRequest.feedback) {
					updates.conversationContext = {
						lastIntent:
							currentState.conversationContext
								?.lastIntent ||
							'regeneration_request',
						pendingQuestions:
							currentState.conversationContext
								?.pendingQuestions || [],
						titleFeedback: regenerationRequest.feedback,
					};
				}
				break;

			case 'research_primary':
				updates.data = {
					...currentState.data,
					primaryKeyword: undefined,
				};
				updates.keywordResearch = {
					...currentState.keywordResearch,
					primaryCandidates: [],
				};
				updates.currentStep = 'primary_keyword'; // Set step to force routing
				updates.halt = null; // Clear any halt to allow execution
				if (regenerationRequest.feedback) {
					updates.conversationContext = {
						lastIntent:
							currentState.conversationContext
								?.lastIntent ||
							'regeneration_request',
						pendingQuestions:
							currentState.conversationContext
								?.pendingQuestions || [],
						primaryKeywordFeedback:
							regenerationRequest.feedback,
					};
				}
				break;

			case 'research_secondary':
				updates.data = {
					...currentState.data,
					secondaryKeywords: [],
				};
				updates.keywordResearch = {
					...currentState.keywordResearch,
					secondaryCandidates: [],
				};
				updates.currentStep = 'secondary_keywords'; // Set step to force routing
				updates.halt = null; // Clear any halt to allow execution
				if (regenerationRequest.feedback) {
					updates.conversationContext = {
						lastIntent:
							currentState.conversationContext
								?.lastIntent ||
							'regeneration_request',
						pendingQuestions:
							currentState.conversationContext
								?.pendingQuestions || [],
						secondaryKeywordFeedback:
							regenerationRequest.feedback,
					};
				}
				break;

			case 'discover':
				updates.outlineApproved = false;
				updates.outlineFeedback =
					regenerationRequest.feedback || '';
				break;
		}

		// Clear halt to allow agent to proceed
		updates.halt = null;

		return updates;
	}

	/**
	 * Prepare state updates for modification confirmations
	 * When user confirms a modification, clear the relevant fields and route to the appropriate step
	 */
	private prepareModificationStateUpdates(
		modificationRequest: string,
		currentState: AgentState
	): Partial<AgentState> {
		const updates: Partial<AgentState> = {
			conversationContext: {
				...currentState.conversationContext,
				modificationRequest: modificationRequest, // Keep for tracking, will be cleared after processing
				lastIntent: 'modification_request',
			},
			halt: null, // Clear any halt to allow execution
		};

		const requestLower = modificationRequest.toLowerCase();

		if (
			requestLower.includes('primary') &&
			requestLower.includes('keyword')
		) {
			// Clear primary keyword and all dependent fields
			updates.data = {
				...currentState.data,
				primaryKeyword: null,
				secondaryKeywords: [],
				title: null,
			};
			updates.currentStep = 'primary_keyword'; // Route to primary keyword research
			updates.outline = []; // Clear outline
			updates.outlineApproved = false;
			updates.draft = '';
			updates.keywordResearch = {
				...currentState.keywordResearch,
				primaryCandidates: [],
				secondaryCandidates: [],
			};
		} else if (
			requestLower.includes('secondary') &&
			requestLower.includes('keyword')
		) {
			// Clear secondary keywords and dependent fields
			updates.data = {
				...currentState.data,
				secondaryKeywords: [],
				title: null,
			};
			updates.currentStep = 'secondary_keywords'; // Route to secondary keyword research
			updates.outline = [];
			updates.outlineApproved = false;
			updates.draft = '';
			updates.keywordResearch = {
				...currentState.keywordResearch,
				secondaryCandidates: [],
			};
		} else if (requestLower.includes('title')) {
			// Clear title and dependent fields
			updates.data = {
				...currentState.data,
				title: null,
			};
			updates.currentStep = 'title'; // Route to title generation
			updates.outline = [];
			updates.outlineApproved = false;
			updates.draft = '';
			updates.titleOptions = [];
			updates.titleSelected = false;
		} else if (requestLower.includes('topic')) {
			// Clear topic and all dependent fields
			updates.data = {
				...currentState.data,
				topic: null,
				primaryKeyword: null,
				secondaryKeywords: [],
				title: null,
			};
			updates.currentStep = 'topic'; // Route to topic input
			updates.outline = [];
			updates.outlineApproved = false;
			updates.draft = '';
			updates.keywordResearch = undefined;
			updates.titleOptions = [];
		}

		return updates;
	}

	/**
	 * Normalize markdown formatting for proper rendering in ReactMarkdown
	 * Ensures newlines are properly formatted for markdown rendering
	 */
	private normalizeMarkdownFormatting(text: string): string {
		if (!text) return text;

		// Replace escaped newlines (\n) with actual newlines
		// Handle both JSON-escaped (\n) and literal newlines
		let normalized = text
			.replace(/\\n/g, '\n') // Replace escaped \n with actual newline
			.replace(/\r\n/g, '\n') // Normalize Windows line endings
			.replace(/\r/g, '\n'); // Normalize Mac line endings

		// ✨ CRITICAL: Handle case where AI returns text without ANY newlines (all on one line)
		// Detect list pattern even when there are no newlines
		// Pattern: "need:" followed by "- **Topic**" or "need: - **Topic**" or "need:- **Topic**"
		if (!normalized.includes('\n') && normalized.includes('- **')) {
			// Add single newline after ":" before first list item (handle both ": -" and ":-")
			normalized = normalized.replace(/:\s*- \*\*/g, ':\n- **');
			normalized = normalized.replace(/:- \*\*/g, ':\n- **'); // Handle ":-" with space
			// Add newline before each subsequent list item (handle both " -" and "-")
			normalized = normalized.replace(/\s+- \*\*/g, '\n- **');
			normalized = normalized.replace(/([^\n])- \*\*/g, '$1\n- **'); // Handle "-" directly after text
			// Add double newline before "Please share" or similar closing (for paragraph break)
			normalized = normalized.replace(
				/\s+Please share/g,
				'\n\nPlease share'
			);
			normalized = normalized.replace(
				/([^\n])Please share/g,
				'$1\n\nPlease share'
			); // Handle no space before "Please"
		}

		// Ensure list items have proper spacing (single newline before list, single between items)
		// If we have a line ending with ":" followed by a list item, ensure single newline
		normalized = normalized.replace(/:\n- /g, ':\n- ');
		normalized = normalized.replace(/:\s+- /g, ':\n- '); // Handle space instead of newline

		// Ensure proper spacing around list items (single newline between items)
		// Add newline before list items if they're not already there
		normalized = normalized.replace(/([^\n])\n- /g, '$1\n- ');
		normalized = normalized.replace(/([^\n])\s+- /g, '$1\n- '); // Handle space instead of newline

		// Ensure double newline before "Please share" or similar closing statements
		normalized = normalized.replace(
			/\n\nPlease share/g,
			'\n\nPlease share'
		);
		normalized = normalized.replace(
			/\nPlease share/g,
			'\n\nPlease share'
		);
		normalized = normalized.replace(
			/\s+Please share/g,
			'\n\nPlease share'
		); // Handle space instead of newline

		// Ensure each list item is on its own line with proper spacing (single newline between items)
		normalized = normalized.replace(/([^\n])\n- \*\*/g, '$1\n- **');

		// ✨ CRITICAL: Remove any blank lines (double newlines) between list items
		// This ensures list items are continuous without empty lines between them

		// First, handle markdown list format: - **Label**: text
		normalized = normalized.replace(
			/(- \*\*[^\n]*)\n\n(- \*\*)/g,
			'$1\n$2'
		);

		// Handle any pattern where list items are separated by blank lines (with whitespace)
		normalized = normalized.replace(
			/(- \*\*[^\n]*)\n\s+\n(- \*\*)/g,
			'$1\n$2'
		);
		normalized = normalized.replace(
			/(- \*\*[^\n]*)\n\s*\n\s*(- \*\*)/g,
			'$1\n$2'
		);

		// Handle rendered markdown format: **Topic**: text (after ReactMarkdown renders - **Topic**:)
		// Pattern: line with **Label**: text, blank line, line with **Label**: text
		normalized = normalized.replace(
			/(\*\*[A-Za-z][^\n]*\*\*: [^\n]*)\n\n(\*\*[A-Za-z][^\n]*\*\*:)/g,
			'$1\n$2'
		);

		// Handle plain format: Topic: text (if markdown is stripped)
		// Pattern: line ending with ": text", blank line, line starting with capital letter and ":"
		normalized = normalized.replace(
			/([A-Z][^\n]*: [^\n]*)\n\n([A-Z][^\n]*:)/g,
			'$1\n$2'
		);

		// Final cleanup: reduce excessive newlines (keep max 2 for paragraph breaks, but single for list items)
		// Replace 3+ consecutive newlines with 2 (for paragraph breaks before closing statements)
		normalized = normalized.replace(/\n{3,}/g, '\n\n');

		// Final pass: ensure no double newlines remain between list items (repeat until no more matches)
		// This handles all variations of list items
		let previousLength = 0;
		let iterations = 0;
		while (normalized.length !== previousLength && iterations < 10) {
			previousLength = normalized.length;
			iterations++;

			// Remove double newlines between markdown list items
			normalized = normalized.replace(
				/(- \*\*[^\n]*)\n\n(- \*\*)/g,
				'$1\n$2'
			);

			// Remove double newlines between any lines that look like list items
			// Pattern: line ending with ":", blank line, line starting with capital letter or "-"
			normalized = normalized.replace(
				/([^\n]+: [^\n]*)\n\n([A-Z-][^\n]*:)/g,
				'$1\n$2'
			);

			// More aggressive: Remove double newline between any two lines that both end with ":"
			// This catches list items in any format
			normalized = normalized.replace(
				/([^\n]+: [^\n]*)\n\n([^\n]+: [^\n]*)/g,
				'$1\n$2'
			);

			// Handle rendered markdown: **Label**: text format
			normalized = normalized.replace(
				/(\*\*[^\n]*\*\*: [^\n]*)\n\n(\*\*[^\n]*\*\*:)/g,
				'$1\n$2'
			);
		}

		return normalized;
	}

	/**
	 * Helper to extract text from Gemini response
	 */
	private extractTextFromResponse(response: any): string {
		try {
			const parts = response?.candidates?.[0]?.content?.parts;
			if (parts && Array.isArray(parts)) {
				const text = parts
					.filter((p: any) => typeof p.text === 'string')
					.map((p: any) => p.text as string)
					.join('')
					.trim();
				if (text) return text;
			}
		} catch (e) {
			console.error('❌ Failed to extract text from response:', e);
		}

		throw new Error('Unable to extract text from Gemini response');
	}
}
