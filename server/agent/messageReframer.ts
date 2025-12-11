/**
 * Message Reframer
 *
 * Reframes lang-graph agent responses to be more user-friendly and conversational.
 * The primary agent uses this to transform technical/lang-graph responses into
 * friendly, interactive messages for users.
 */

import { AgentState } from './state';

export interface ReframedMessage {
	message: string;
	metadata?: {
		keywordSelection?: {
			type: 'primary' | 'secondary';
			candidates: any[];
		};
		titleSelection?: {
			titles: string[];
		};
		outlineApproval?: {
			outline: any[];
		};
		[key: string]: any;
	};
}

/**
 * Reframe lang-graph state into user-friendly messages
 */
export function reframeStateToMessage(
	state: AgentState,
	lastNodeExecuted?: string
): ReframedMessage {
	// Check what the agent just completed
	if (state.halt) {
		return handleHaltState(state);
	}

	// Check based on last executed node
	if (lastNodeExecuted) {
		return handleNodeCompletion(state, lastNodeExecuted);
	}

	// Default: check state to determine what happened
	return checkStateAndReframe(state);
}

/**
 * Handle halt states (when agent is waiting for user input)
 */
function handleHaltState(state: AgentState): ReframedMessage {
	const reason = state.halt?.reason;

	switch (reason) {
		case 'await_keyword_selection':
			const primaryCandidates =
				state.keywordResearch?.primaryCandidates || [];
			if (primaryCandidates.length > 0) {
				// Return minimal message - keyword list will be shown separately via metadata
				return {
					message: `🎯 **What main keyword should this article rank for?**\n\nLet me present you some suggestions. If you would like to give of your own then please provide it.`,
					metadata: {
						keywordSelection: {
							type: 'primary',
							candidates: primaryCandidates,
						},
					},
				};
			}
			return {
				message: "I'm researching primary keywords for your topic. This will just take a moment...",
			};

		case 'await_secondary_selection':
			const secondaryCandidates =
				state.keywordResearch?.secondaryCandidates || [];
			if (secondaryCandidates.length > 0) {
				return {
					message: `Perfect! Now let's find some secondary keywords that complement "${state.data.primaryKeyword}".\n\nLet me present you some suggestions. If you would like to give of your own then please provide it.`,
					metadata: {
						keywordSelection: {
							type: 'secondary',
							candidates: secondaryCandidates,
						},
					},
				};
			}
			return {
				message: "I'm researching secondary keywords. Almost there...",
			};

		case 'await_title_selection':
			const titles = state.titleOptions || [];
			if (titles.length > 0) {
				return {
					message: `Excellent! I've generated ${titles.length} compelling title options for your blog. Take a look and pick your favorite:`,
					metadata: {
						titleSelection: {
							titles: titles,
						},
					},
				};
			}
			return {
				message: "I'm generating some great title options for you...",
			};

		case 'awaiting_approval':
			if (state.outline && state.outline.length > 0) {
				return {
					message: `Perfect! I've created a comprehensive outline with ${state.outline.length} main sections. Please review it and let me know if you'd like any changes, or approve it to start writing!`,
					metadata: {
						outlineApproval: {
							outline: state.outline,
						},
					},
				};
			}
			return {
				message: "I'm creating your blog outline. This is an important step!",
			};

		case 'await_interlinking':
			return {
				message: 'Would you like to add internal or external links to your blog? This is optional but can boost SEO!',
			};

		case 'await_references':
			return {
				message: 'Would you like to add reference materials or URLs? This helps me create more accurate and well-researched content.',
			};

		default:
			return {
				message: "I'm processing your request. Please wait a moment...",
			};
	}
}

/**
 * Handle node completion messages
 */
function handleNodeCompletion(
	state: AgentState,
	nodeName: string
): ReframedMessage {
	switch (nodeName) {
		case 'research_primary':
			if (state.keywordResearch?.primaryCandidates?.length > 0) {
				// Return minimal message - keyword list will be shown separately via metadata
				// This ensures the "researching" message appears first, then keyword list appears separately
				return {
					message: `🎯 **What main keyword should this article rank for?**\n\nLet me present you some suggestions. If you would like to give of your own then please provide it.`,
					metadata: {
						keywordSelection: {
							type: 'primary',
							candidates:
								state.keywordResearch
									.primaryCandidates,
						},
					},
				};
			}
			return {
				message: "I've completed the primary keyword research. Let me show you the results!",
			};

		case 'research_secondary':
			if (state.keywordResearch?.secondaryCandidates?.length > 0) {
				return {
					message: `✨ **Secondary Keywords Ready!**\n\nLet me present you some suggestions. If you would like to give of your own then please provide it.`,
					metadata: {
						keywordSelection: {
							type: 'secondary',
							candidates:
								state.keywordResearch
									.secondaryCandidates,
						},
					},
				};
			}
			return {
				message: 'Secondary keyword research is complete!',
			};

		case 'title_generation':
			if (state.titleOptions && state.titleOptions.length > 0) {
				return {
					message: `📝 **Title Options Generated!**\n\nI've created ${state.titleOptions.length} SEO-optimized title options. Each one is designed to attract readers and search engines. Pick the one that resonates with you:`,
					metadata: {
						titleSelection: {
							titles: state.titleOptions,
						},
					},
				};
			}
			return {
				message: "I've generated some great title options for you!",
			};

		case 'discover':
			if (state.outline && state.outline.length > 0) {
				return {
					message: `📋 **Outline Created!**\n\nI've structured your blog into ${state.outline.length} main sections. This outline will guide the content creation and ensure we cover all important points. Please review it:`,
					metadata: {
						outlineApproval: {
							outline: state.outline,
						},
					},
				};
			}
			return {
				message: "I've created your blog outline!",
			};

		case 'proposal':
			const sectionIndex = state.progress?.sectionIndex || 0;
			const totalSections = state.outline?.length || 0;
			// If this is the first section and outline was just approved, show starting message
			if (
				sectionIndex === 0 &&
				state.outlineApproved &&
				totalSections > 0
			) {
				return {
					message: "✍️ **Starting blog generation...**\n\nI'll now create your blog post section by section, incorporating all your keywords and following the approved outline.",
				};
			}
			if (sectionIndex < totalSections) {
				return {
					message: `✍️ **Writing Section ${
						sectionIndex + 1
					} of ${totalSections}**\n\nI'm crafting the content for "${
						state.outline?.[sectionIndex]?.name ||
						'this section'
					}". This might take a moment...`,
				};
			}
			return {
				message: "I've finished writing all sections!",
			};

		case 'final_blog':
			return {
				message: `🎉 **Blog Complete!**\n\nI've finished writing your entire blog post. The content is ready for review!`,
			};

		default:
			return {
				message: "I've completed that step. Moving forward...",
			};
	}
}

/**
 * Check state and reframe based on current state
 */
function checkStateAndReframe(state: AgentState): ReframedMessage {
	// Check if we have keyword candidates ready
	if (
		state.keywordResearch?.primaryCandidates?.length > 0 &&
		!state.data.primaryKeyword
	) {
		return {
			message: `Great! I've researched primary keywords for "${
				state.data.topic || 'your topic'
			}". Here are the best options:`,
			metadata: {
				keywordSelection: {
					type: 'primary',
					candidates:
						state.keywordResearch.primaryCandidates,
				},
			},
		};
	}

	// Check if we have title options ready
	if (
		state.titleOptions &&
		state.titleOptions.length > 0 &&
		!state.titleSelected
	) {
		return {
			message: `I've generated ${state.titleOptions.length} compelling title options. Take your pick:`,
			metadata: {
				titleSelection: {
					titles: state.titleOptions,
				},
			},
		};
	}

	// Check if outline is ready for approval
	if (state.outline && state.outline.length > 0 && !state.outlineApproved) {
		return {
			message: `I've created an outline with ${state.outline.length} sections. Please review and approve to continue:`,
			metadata: {
				outlineApproval: {
					outline: state.outline,
				},
			},
		};
	}

	// Default friendly message
	return {
		message: "I'm working on your blog. Everything is progressing smoothly!",
	};
}

/**
 * Reframe regeneration messages
 */
export function reframeRegenerationMessage(
	targetNode: string,
	feedback?: string
): string {
	const feedbackText = feedback
		? ` I'll incorporate your feedback: "${feedback}".`
		: '';

	switch (targetNode) {
		case 'title_generation':
			return `Got it! I'm regenerating the title options with fresh ideas.${feedbackText} This will just take a moment...`;

		case 'research_primary':
			return `Perfect! I'm researching new primary keywords.${feedbackText} Let me find better options for you...`;

		case 'research_secondary':
			return `Sure thing! I'm finding new secondary keywords.${feedbackText} Almost there...`;

		case 'discover':
			return `Absolutely! I'm regenerating the outline based on your feedback.${feedbackText} This might take a moment...`;

		default:
			return `I'm regenerating that for you.${feedbackText} Please wait...`;
	}
}
