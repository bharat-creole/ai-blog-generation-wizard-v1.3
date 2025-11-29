import { StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './state';
import { BrowserCheckpointer } from './persistence/BrowserCheckpointer';

// Import nodes
import { researchPrimaryNode, researchSecondaryNode } from './nodes/research';
import { titleGenerationNode, discoveryNode } from './nodes/planning';
import { proposalNode, finalBlogGenerationNode } from './nodes/generation';

// Define the routing logic
const route = (state: AgentState) => {
    // Priority: If outline feedback exists, regenerate outline
    // Note: We need to handle this in the state schema or node logic

    // Step 1: Primary keyword selected?
    if (!state.data.primaryKeyword?.trim()) return 'research_primary';

    // Step 2: Secondary keywords present?
    if (!state.data.secondaryKeywords || state.data.secondaryKeywords.length === 0)
        return 'research_secondary';

    // Step 3: Title generation
    if (!state.data.title?.trim()) return 'title_generation';

    // Step 4: Outline generation
    if (!state.outline || state.outline.length === 0) return 'discovery';

    // Step 5: Outline approval
    if (!state.outlineApproved) return '__end__'; // Halt for approval

    // Step 6: Section-by-section generation
    const idx = state.progress.sectionIndex ?? 0;
    if (idx < state.outline.length) return 'proposal';

    // Step 7: Final blog generation
    // if (!state.finalBlogGenerated) return 'final_blog'; // Add this flag to schema later

    return '__end__';
};

// Define the graph
const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('research_primary', researchPrimaryNode)
    .addNode('research_secondary', researchSecondaryNode)
    .addNode('title_generation', titleGenerationNode)
    .addNode('discovery', discoveryNode)
    .addNode('proposal', proposalNode)
    .addNode('final_blog', finalBlogGenerationNode)

    // Define edges with conditional routing
    .setEntryPoint('research_primary') // Start here, but router will redirect if needed? 
    // Actually, LangGraph usually starts at a specific node or uses a conditional entry point.
    // Let's use a conditional entry point to jump to the right step based on state.

    .addConditionalEdges('__start__', route)
    .addConditionalEdges('research_primary', route)
    .addConditionalEdges('research_secondary', route)
    .addConditionalEdges('title_generation', route)
    .addConditionalEdges('discovery', route)
    .addConditionalEdges('proposal', route)
    .addConditionalEdges('final_blog', route);

// Initialize checkpointer
export const checkpointer = new BrowserCheckpointer();

// Compile the graph with persistence
export const graph = workflow.compile({
    checkpointer,
});
