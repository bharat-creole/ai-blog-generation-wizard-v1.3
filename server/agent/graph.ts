import { StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './state';
import { FileCheckpointer } from './checkpointer';

// Import nodes
import { researchPrimaryNode, researchSecondaryNode } from './nodes/research';
import { titleGenerationNode, discoveryNode } from './nodes/planning';
import { proposalNode, finalBlogGenerationNode } from './nodes/generation';
import { isValidTopic, isGibberish } from './validation';
// Define the routing logic - NOW SUPPORTS BIDIRECTIONAL NAVIGATION
const route = (state: AgentState) => {
	// ✨ PRIORITY: Check for regeneration requests in conversation context
	// This allows direct routing to specific nodes for regeneration
	if (state.conversationContext?.primaryKeywordFeedback) {
		console.log(`   🔄 [ROUTE] Primary keyword regeneration detected, routing to research_primary`);
		return 'research_primary';
	}

	if (state.conversationContext?.secondaryKeywordFeedback) {
		console.log(`   🔄 [ROUTE] Secondary keyword regeneration detected, routing to research_secondary`);
		return 'research_secondary';
	}

	// CRITICAL: If there's a halt, stop immediately
	if (state.halt) {
		console.log(`   🛑 Graph halted: ${state.halt.reason}`);
		return '__end__';
	}

	// ✨ VALIDATION: Check if topic is valid before proceeding
	if (state.data.topic) {
		if (isGibberish(state.data.topic) || !isValidTopic(state.data.topic)) {
			console.log(`   🛑 Invalid topic detected: "${state.data.topic}"`);
			return '__end__';
		}
	}

	// ✨ NEW: Use currentStep for step-based routing
	// This allows jumping back to any step for modifications
	console.log(`   📍 Routing State - Step: ${state.currentStep}, Topic: "${state.data?.topic || 'N/A'}"`);

	switch (state.currentStep) {
		case 'topic':
			// Check if topic is valid
			if (!state.data?.topic || !isValidTopic(state.data.topic)) {
				console.log(`   → Route: __end__ (awaiting valid topic) - Found Topic: "${state.data?.topic || ''}" (Valid: ${isValidTopic(state.data?.topic)})`);
				return '__end__';
			}
			console.log(`   → Route: research_primary`);
			return 'research_primary';

		case 'primary_keyword':
			// Check if we need to research or if keyword is already set
			if (!state.data.primaryKeyword?.trim()) {
				console.log(`   → Route: research_primary`);
				return 'research_primary';
			}
			console.log(`   → Route: research_secondary`);
			return 'research_secondary';

		case 'secondary_keywords':
			// Check if we need to research or if keywords are already set
			if (
				!state.data.secondaryKeywords ||
				state.data.secondaryKeywords.length === 0
			) {
				console.log(`   → Route: research_secondary`);
				return 'research_secondary';
			}
			console.log(`   → Route: title_generation`);
			return 'title_generation';

		case 'title':
			// Check if title is set
			if (!state.data.title?.trim()) {
				console.log(`   → Route: title_generation`);
				return 'title_generation';
			}
			// After title, check automation level
			console.log(
				`   🔍 Automation Level: ${state.preferences?.automationLevel}`
			);
			if (state.preferences?.automationLevel === 'full') {
				// Full automation - skip optional steps, go to outline
				console.log(`   → Route: discovery (full automation)`);
				return 'discovery';
			}
			// Guided mode - move to references step (optional)
			// Check if references are already provided
			if (state.data.referenceUrls && state.data.referenceUrls.length > 0) {
				// References provided, check interlinking
				if (state.data.interlinks && state.data.interlinks.length > 0) {
					// Both optional steps done, go to outline
					console.log(`   → Route: discovery (optional steps complete)`);
					return 'discovery';
				} else {
					// Move to interlinking
					console.log(`   → Route: __end__ (awaiting interlinking)`);
					return '__end__';
				}
			} else {
				// Move to references step
				console.log(`   → Route: __end__ (awaiting references)`);
				return '__end__';
			}

		case 'references':
			// Optional step - halt for user input
			// User can provide references or skip
			console.log(
				`   → Route: __end__ (awaiting references input)`
			);
			return '__end__';

		case 'interlinking':
			// Optional step - halt for user input
			// User can provide interlinks or skip
			console.log(
				`   → Route: __end__ (awaiting interlinking input)`
			);
			return '__end__';

		case 'outline_confirmation':
			// Halt to ask user if they want to proceed to outline generation
			console.log(
				`   → Route: __end__ (awaiting outline confirmation)`
			);
			return '__end__';

		case 'outline':
			// Check if outline exists
			if (!state.outline || state.outline.length === 0) {
				console.log(`   → Route: discovery`);
				return 'discovery';
			}
			// Check if outline is approved
			if (!state.outlineApproved) {
				console.log(
					`   → Route: __end__ (awaiting outline approval)`
				);
				return '__end__';
			}
			console.log(`   → Route: proposal`);
			return 'proposal';

		case 'generation':
			// Section-by-section generation
			const idx = state.progress.sectionIndex ?? 0;
			if (idx < state.outline.length) {
				console.log(`   → Route: proposal (section ${idx})`);
				return 'proposal';
			}
			console.log(`   → Route: __end__ (complete)`);
			return '__end__';

		default:
			// Fallback to topic step if currentStep is invalid
			console.log(
				`   ⚠️  Unknown step: ${state.currentStep}, defaulting to topic`
			);
			return '__end__';
	}
};

// Define the graph
const workflow = new StateGraph(AgentStateAnnotation)
	.addNode('research_primary', researchPrimaryNode)
	.addNode('research_secondary', researchSecondaryNode)
	.addNode('title_generation', titleGenerationNode)
	.addNode('discovery', discoveryNode)
	.addNode('proposal', proposalNode)
	.addNode('final_blog', finalBlogGenerationNode)

	.addConditionalEdges('__start__', route)
	.addConditionalEdges('research_primary', route)
	.addConditionalEdges('research_secondary', route)
	.addConditionalEdges('title_generation', route)
	.addConditionalEdges('discovery', route)
	.addConditionalEdges('proposal', route)
	.addConditionalEdges('final_blog', route);

// Initialize checkpointer
export const checkpointer = new FileCheckpointer();

// Compile the graph
export const graph = workflow.compile({
	checkpointer,
});
