# 🤖 AI Blog Generation Agent - Complete Implementation Guide

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Complete Flow Diagram](#complete-flow-diagram)
3. [Component Breakdown](#component-breakdown)
4. [State Management](#state-management)
5. [Decision Points & Routing](#decision-points--routing)
6. [Automation Levels](#automation-levels)
7. [Bidirectional Navigation](#bidirectional-navigation)
8. [API Endpoints](#api-endpoints)

---

## 🏗️ Architecture Overview

The agent system is built using **LangGraph** (state machine) with a **message-based conversation API**. It follows a three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AgentMode.tsx                                        │  │
│  │  - UI Orchestration                                   │  │
│  │  - State Management (useAgentState)                   │  │
│  │  - Message Handling (useAgentExecutionV3)            │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND (Express)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/agent/message                                   │  │
│  │  - Intent Classification                              │  │
│  │  - Conversation Handler                               │  │
│  │  - LangGraph Execution                                │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              LANGGRAPH STATE MACHINE                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Graph Router (route function)                       │  │
│  │  ├─ research_primary                                  │  │
│  │  ├─ research_secondary                                 │  │
│  │  ├─ title_generation                                  │  │
│  │  ├─ discovery (outline)                                │  │
│  │  ├─ proposal (content generation)                     │  │
│  │  └─ final_blog                                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER SENDS MESSAGE                                   │
│                    (AgentMode.tsx → handleSend)                              │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 1: FRONTEND INTENT ANALYSIS                          │
│                    File: components/AgentMode.tsx                           │
│                                                                              │
│  Analyzes user message for:                                                 │
│  • wantsBlogGeneration: "generate blog", "create blog", etc.                │
│  • wantsFullAutomation: "automatically", "handle it yourself"               │
│  • wantsAutomation: "switch to automation"                                  │
│                                                                              │
│  Actions:                                                                    │
│  • If no topic → Ask for topic                                              │
│  • If topic provided → Initialize agent state                               │
│  • If automation requested → Update preferences                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 2: SEND TO BACKEND                                   │
│                    File: useAgentExecutionV3.ts                              │
│                                                                              │
│  POST /api/agent/message                                                     │
│  • Message: user input                                                       │
│  • ThreadId: unique session ID                                              │
│  • CurrentState: agent state (AgentState)                                    │
│  • Stream: true (Server-Sent Events)                                        │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 3: INTENT CLASSIFICATION                             │
│                    File: server/agent/intentClassifier.ts                   │
│                                                                              │
│  Uses Gemini AI to classify user message:                                   │
│                                                                              │
│  Intent Types:                                                               │
│  • greeting: "hi", "hello"                                                  │
│  • help_request: "help", "what can you do"                                  │
│  • off_topic: unrelated queries                                             │
│  • full_automation: "generate automatically", "handle it"                   │
│  • partial_info: "write about X", topic provided                            │
│  • refinement: "change title to Y", "update keyword"                       │
│  • approval: "yes", "approve", "continue"                                    │
│  • skip_step: "skip", "next"                                               │
│                                                                              │
│  Extracted Data:                                                             │
│  • topic: extracted topic string                                            │
│  • primaryKeyword: extracted keyword                                        │
│  • secondaryKeywords: array of keywords                                     │
│  • title: extracted title                                                   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 4: CONVERSATION HANDLER                              │
│                    File: server/agent/conversationHandler.ts                 │
│                                                                              │
│  Routes based on intent type:                                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ greeting → handleGreeting()                                         │    │
│  │   Returns: Welcome message, shouldRunAgent: false                   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ full_automation → handleFullAutomation()                            │    │
│  │   • Sets automationLevel: 'full'                                   │    │
│  │   • Sets skipOptionalSteps: true                                   │    │
│  │   • Sets autoFillFields: [primaryKeyword, secondaryKeywords, title]│    │
│  │   • Returns: shouldRunAgent: true                                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ partial_info → handlePartialInfo()                                  │    │
│  │   • Extracts topic/keywords/title from message                     │    │
│  │   • Updates state.data with extracted info                          │    │
│  │   • Sets currentStep based on what was provided                    │    │
│  │   • Returns: shouldRunAgent: true                                   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ refinement → handleRefinement()                                    │    │
│  │   • Detects which field to modify (topic/keyword/title)            │    │
│  │   • Clears dependent fields (e.g., title clears outline)           │    │
│  │   • Jumps to appropriate step (bidirectional navigation)           │    │
│  │   • Returns: shouldRunAgent: true                                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ approval → handleApproval()                                        │    │
│  │   • Sets outlineApproved: true                                     │    │
│  │   • Clears halt reason                                            │    │
│  │   • Returns: shouldRunAgent: true                                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ skip_step → handleSkipStep()                                       │    │
│  │   • Marks current step as completed                                │    │
│  │   • Moves to next step                                             │    │
│  │   • Returns: shouldRunAgent: true                                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 5: LANGGRAPH EXECUTION                               │
│                    File: server/agent/graph.ts                              │
│                    (Only if shouldRunAgent = true)                           │
│                                                                              │
│  The route() function decides next step based on currentStep:               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'topic'                                                │    │
│  │   → If no topic: __end__ (wait)                                    │    │
│  │   → If topic exists: research_primary                              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'primary_keyword'                                     │    │
│  │   → If no keyword: research_primary                                │    │
│  │   → If keyword exists: research_secondary                          │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'secondary_keywords'                                  │    │
│  │   → If no keywords: research_secondary                             │    │
│  │   → If keywords exist: title_generation                            │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'title'                                               │    │
│  │   → If no title: title_generation                                  │    │
│  │   → If title exists:                                               │    │
│  │     • Full automation → discovery (skip optional)                  │    │
│  │     • Guided mode → __end__ (await optional steps)                 │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'outline'                                             │    │
│  │   → If no outline: discovery                                       │    │
│  │   → If outline not approved: __end__ (await approval)              │    │
│  │   → If approved: proposal                                          │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ currentStep: 'generation'                                          │    │
│  │   → If sections remaining: proposal                                │    │
│  │   → If all done: __end__                                           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 6: NODE EXECUTION                                    │
│                    Files: server/agent/nodes/*.ts                            │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ research_primary → researchPrimaryNode()                          │    │
│  │   • Fetches keywords from Google Ads API                           │    │
│  │   • Scores and ranks keywords                                      │    │
│  │   • If automation: auto-selects best keyword                        │    │
│  │   • If guided: halts at 'await_keyword_selection'                  │    │
│  │   • Returns: { halt, keywordCandidates, currentStep }              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ research_secondary → researchSecondaryNode()                       │    │
│  │   • Fetches secondary keywords based on primary                    │    │
│  │   • Filters out primary keyword                                    │    │
│  │   • If automation: auto-selects top 5                              │    │
│  │   • If guided: halts at 'await_secondary_selection'                │    │
│  │   • Returns: { halt, keywordCandidates, currentStep }              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ title_generation → titleGenerationNode()                          │    │
│  │   • Generates 5-10 title options using Gemini                     │    │
│  │   • If automation: auto-selects best title                        │    │
│  │   • If guided: halts at 'await_title_selection'                   │    │
│  │   • Returns: { halt, titleCandidates, currentStep }               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ discovery → discoveryNode()                                        │    │
│  │   • Generates blog outline using Gemini                            │    │
│  │   • Uses references if provided                                    │    │
│  │   • ALWAYS halts at 'awaiting_approval'                            │    │
│  │   • Returns: { outline, halt, currentStep }                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ proposal → proposalNode()                                          │    │
│  │   • Generates content section by section                           │    │
│  │   • Appends each section to draft                                  │    │
│  │   • Continues until all sections done                             │    │
│  │   • Returns: { draft, progress, currentStep }                     │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ final_blog → finalBlogGenerationNode()                             │    │
│  │   • Final formatting and cleanup                                   │    │
│  │   • Returns: { draft (polished), finalBlogGenerated: true }        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 7: STATE UPDATES (SSE)                               │
│                    File: server/index.ts                                     │
│                                                                              │
│  Server-Sent Events stream:                                                  │
│  • event: intent → Initial assistant message                                │
│  • event: progress → State updates from each node                           │
│  • event: done → Final state with complete response                         │
│  • event: error → Error messages                                            │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 8: FRONTEND STATE SYNC                               │
│                    File: useAgentExecutionV3.ts                              │
│                                                                              │
│  Updates local state:                                                        │
│  • agent: updated AgentState                                                 │
│  • outline: generated outline                                               │
│  • draft: blog content                                                      │
│  • messages: assistant responses                                             │
│  • UI metadata: keywordSelection, titleSelection, outlineApproval          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Component Breakdown

### Frontend Components

#### 1. **AgentMode.tsx** (Main Orchestrator)

- **Purpose**: Main UI component that orchestrates the entire agent flow
- **Key Responsibilities**:
     - Manages all UI state (messages, draft, outline, etc.)
     - Handles user input and sends to backend
     - Renders chat interface, blog content, panels
     - Coordinates between different UI components

#### 2. **useAgentState.ts** (State Management Hook)

- **Purpose**: Centralized state management for agent UI
- **Manages**: Messages, draft, outline, agent state, UI flags

#### 3. **useAgentExecutionV3.ts** (Execution Hook)

- **Purpose**: Handles communication with backend API
- **Key Functions**:
     - `sendUserMessage()`: Sends message to `/api/agent/message`
     - Handles Server-Sent Events (SSE) streaming
     - Maps backend state to frontend format
     - Updates UI with progress messages

#### 4. **useIntentAnalysis.ts** (Intent Analysis Hook)

- **Purpose**: Analyzes user messages for intent patterns
- **Detects**: Blog generation requests, automation requests, etc.

### Backend Components

#### 1. **intentClassifier.ts** (Intent Classification)

- **Purpose**: Uses Gemini AI to classify user messages
- **Input**: User message, current state, API key
- **Output**: `UserIntent` with type and extracted data

#### 2. **conversationHandler.ts** (Conversation Orchestrator)

- **Purpose**: Main entry point for processing user messages
- **Key Function**: `processMessage()`
- **Routes**: Different intent types to appropriate handlers
- **Returns**: `ConversationResponse` with message, state updates, and execution flag

#### 3. **graph.ts** (LangGraph State Machine)

- **Purpose**: Defines the workflow graph and routing logic
- **Key Function**: `route()` - decides next step based on `currentStep`
- **Nodes**: research_primary, research_secondary, title_generation, discovery, proposal, final_blog

#### 4. **state.ts** (State Schema)

- **Purpose**: Defines the AgentState schema using LangGraph Annotation
- **Key Fields**:
     - `data`: Blog data (topic, keywords, title, etc.)
     - `outline`: Generated outline sections
     - `draft`: Current blog content
     - `currentStep`: Current workflow step
     - `halt`: Halt reason if waiting for user input
     - `preferences`: Automation level and settings

### Node Implementations

#### 1. **research.ts** (Keyword Research Nodes)

- `researchPrimaryNode()`: Fetches primary keyword candidates
- `researchSecondaryNode()`: Fetches secondary keyword candidates
- **Uses**: Google Ads API (or fallback simulation)

#### 2. **planning.ts** (Planning Nodes)

- `titleGenerationNode()`: Generates title options using Gemini
- `discoveryNode()`: Generates blog outline using Gemini

#### 3. **generation.ts** (Content Generation Nodes)

- `proposalNode()`: Generates blog content section by section
- `finalBlogGenerationNode()`: Final polish and formatting

---

## 📊 State Management

### AgentState Structure

```typescript
{
  // Core Data
  data: {
    topic: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    title: string;
    targetLocation: string;
    referenceUrls: string[];
    interlinks: Interlink[];
  };

  // Workflow State
  currentStep: 'topic' | 'primary_keyword' | 'secondary_keywords' |
               'title' | 'outline' | 'generation';
  halt: { reason: string } | null;

  // Content
  outline: OutlineSection[];
  draft: string;
  outlineApproved: boolean;

  // Progress
  progress: { sectionIndex: number };

  // Preferences
  preferences: {
    automationLevel: 'full' | 'guided' | 'manual';
    skipOptionalSteps: boolean;
    autoSelectBestOptions: boolean;
  };

  // UI Data
  keywordCandidates: KwRow[];
  titleCandidates: string[];

  // Tracking
  userProvidedFields: Set<string>;
  autoFillFields: Set<string>;
  trace: Array<{ step: string; info?: any; at: number }>;
}
```

### State Flow

1. **Initialization**: State created with default values
2. **Updates**: Each node returns `Partial<AgentState>` which is merged
3. **Persistence**: State persisted via LangGraph checkpointer (file-based)
4. **Synchronization**: Frontend syncs with backend state after each message

---

## 🎯 Decision Points & Routing

### Router Logic (`graph.ts` → `route()`)

The router uses `currentStep` to determine the next action:

```typescript
switch (currentStep) {
	case 'topic':
		if (!topic) return '__end__'; // Wait
		return 'research_primary'; // Proceed

	case 'primary_keyword':
		if (!keyword) return 'research_primary'; // Research needed
		return 'research_secondary'; // Move to next step

	case 'secondary_keywords':
		if (!keywords.length) return 'research_secondary';
		return 'title_generation';

	case 'title':
		if (!title) return 'title_generation';
		if (automationLevel === 'full') return 'discovery';
		return '__end__'; // Wait for optional steps

	case 'outline':
		if (!outline.length) return 'discovery';
		if (!outlineApproved) return '__end__'; // Wait for approval
		return 'proposal';

	case 'generation':
		if (sectionIndex < outline.length) return 'proposal';
		return '__end__'; // Complete
}
```

### Halt Reasons

The agent halts (waits for user input) at these points:

- `await_keyword_selection`: Waiting for primary keyword selection
- `await_secondary_selection`: Waiting for secondary keyword selection
- `await_title_selection`: Waiting for title selection
- `await_interlinking_selection`: Waiting for interlinking input (optional)
- `await_references_selection`: Waiting for references input (optional)
- `awaiting_approval`: Waiting for outline approval (always required)

---

## 🤖 Automation Levels

### Full Automation (`automationLevel: 'full'`)

**Behavior**:

- Auto-selects primary keyword (best ranked)
- Auto-selects top 5 secondary keywords
- Auto-selects best title
- Skips optional steps (interlinking, references)
- Runs continuously until outline approval
- After approval: Generates all sections automatically

**User Interaction**: Only required for outline approval

### Guided Mode (`automationLevel: 'guided'`)

**Behavior**:

- Halts for keyword selection
- Halts for title selection
- Skips optional steps (unless user provides data)
- User chooses from options at each step
- After approval: Generates sections automatically

**User Interaction**: Required at keyword/title selection and outline approval

### Manual Mode (`automationLevel: 'manual'`)

**Behavior**:

- Halts at every decision point
- User controls all selections
- More interactive, step-by-step

**User Interaction**: Required at every step

---

## 🔄 Bidirectional Navigation

The agent supports jumping back to any step for modifications:

### How It Works

1. **User Request**: "Change the title to X" or "I want to modify the keywords"
2. **Intent Classification**: Detects `refinement` intent
3. **Conversation Handler**:
      - Identifies which field to modify
      - Clears dependent fields (e.g., title change clears outline)
      - Sets `currentStep` to appropriate step
      - Clears `halt` to allow graph execution
4. **Graph Router**: Routes to the appropriate node based on `currentStep`
5. **Node Execution**: Regenerates options or uses new value

### Example Flow

```
User: "Change the title to 'AI in Healthcare'"
  ↓
Intent: refinement (title)
  ↓
Conversation Handler:
  - Sets currentStep: 'title'
  - Clears outline and draft
  - Sets data.title: 'AI in Healthcare'
  ↓
Graph Router:
  - Sees currentStep: 'title'
  - Sees title exists
  - Routes to 'discovery' (if full automation)
  ↓
Discovery Node:
  - Generates new outline with new title
```

---

## 🌐 API Endpoints

### POST `/api/agent/message`

**Purpose**: Main conversation endpoint

**Request**:

```json
{
	"message": "Write about AI in healthcare",
	"threadId": "thread-1234567890",
	"currentState": {
		/* AgentState */
	},
	"stream": true
}
```

**Response** (SSE Stream):

```
event: intent
data: { "assistantMessage": "...", "shouldRunAgent": true }

event: progress
data: { "research_primary": { /* state update */ } }

event: done
data: { "assistantMessage": "...", "state": { /* final state */ } }
```

### POST `/api/agent/invoke`

**Purpose**: Direct graph execution (legacy)

**Request**:

```json
{
	"state": {
		/* AgentState */
	},
	"threadId": "thread-1234567890"
}
```

### GET `/api/agent/state/:threadId`

**Purpose**: Get current agent state

### DELETE `/api/agent/state/:threadId`

**Purpose**: Reset/delete agent state

---

## 🔍 Key Design Patterns

### 1. **State Machine Pattern**

- LangGraph provides state machine capabilities
- Each node is a state transition
- Router decides next transition based on current state

### 2. **Message-Based Architecture**

- All communication via messages
- Frontend sends user messages
- Backend responds with assistant messages + state updates
- Supports streaming for real-time updates

### 3. **Intent-Driven Routing**

- User messages classified into intents
- Different handlers for different intents
- Allows natural language interaction

### 4. **Bidirectional Navigation**

- `currentStep` field enables jumping to any step
- Modification requests clear dependent fields
- Graph router handles step transitions

### 5. **Automation Abstraction**

- `automationEngine` determines behavior based on preferences
- Nodes check `shouldAutoFill()` and `needsUserInput()`
- Consistent behavior across all nodes

---

## 📝 Example User Journey

### Scenario: Full Automation

```
User: "Generate blog automatically about AI in healthcare"
  ↓
Frontend: Detects wantsFullAutomation + topic
  ↓
Backend: Intent = full_automation
  ↓
Conversation Handler: Sets automationLevel = 'full'
  ↓
Graph: Routes to research_primary
  ↓
Node: Auto-selects best keyword
  ↓
Graph: Routes to research_secondary
  ↓
Node: Auto-selects top 5 keywords
  ↓
Graph: Routes to title_generation
  ↓
Node: Auto-selects best title
  ↓
Graph: Routes to discovery
  ↓
Node: Generates outline → Halts for approval
  ↓
User: "Yes, approve"
  ↓
Backend: Intent = approval
  ↓
Graph: Routes to proposal
  ↓
Node: Generates section 1 → Updates draft
  ↓
Node: Generates section 2 → Updates draft
  ↓
... (continues for all sections)
  ↓
Graph: Routes to final_blog
  ↓
Node: Final polish → Complete
```

### Scenario: Guided Mode with Modifications

```
User: "Write about cloud computing"
  ↓
Backend: Intent = partial_info, extracts topic
  ↓
Graph: Routes to research_primary
  ↓
Node: Fetches keywords → Halts for selection
  ↓
User: Selects keyword
  ↓
Graph: Routes to research_secondary
  ↓
Node: Fetches secondary keywords → Halts for selection
  ↓
User: Selects keywords
  ↓
Graph: Routes to title_generation
  ↓
Node: Generates titles → Halts for selection
  ↓
User: "Change the title to 'AWS Guide'"
  ↓
Backend: Intent = refinement (title)
  ↓
Conversation Handler: Clears outline, sets currentStep = 'title'
  ↓
Graph: Routes to discovery (title exists)
  ↓
Node: Generates new outline with new title → Halts for approval
  ↓
User: "Approve"
  ↓
Graph: Routes to proposal
  ↓
Node: Generates content → Complete
```

---

## 🎨 UI Components

### Chat Interface

- Displays conversation history
- Shows keyword/title selection UI when halted
- Shows outline approval UI
- Real-time progress messages

### Blog Content Display

- Shows draft content as it's generated
- Markdown rendering
- Section-by-section updates

### Panels

- **BlogInfoPanel**: Shows current blog data
- **TracePanel**: Shows execution trace
- **SettingsPanel**: Configuration

---

## 🔧 Configuration

### Environment Variables

**Backend**:

- `GOOGLE_ADS_DEVELOPER_TOKEN`: Google Ads API token
- `GOOGLE_ADS_CUSTOMER_ID`: Customer ID
- `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`: OAuth credentials

**Frontend**:

- User provides Gemini API key via Settings panel

---

## 🚀 Future Enhancements

1. **Streaming Content Generation**: Real-time section streaming
2. **Multi-thread Support**: Multiple concurrent blog generations
3. **Advanced Modifications**: Edit specific sections
4. **Template System**: Pre-defined blog templates
5. **SEO Analysis**: Real-time SEO scoring during generation

---

## 📚 Related Files

- **Frontend**: `components/AgentMode.tsx`, `components/agentComponents/`
- **Backend**: `server/agent/`, `server/index.ts`
- **Services**: `services/agentService.ts`, `services/geminiService.ts`, `services/keywordService.ts`
- **Types**: `types.ts`, `server/agent/state.ts`

---

_Last Updated: Based on current implementation in `feat/agent-back-forth-flow` branch_
