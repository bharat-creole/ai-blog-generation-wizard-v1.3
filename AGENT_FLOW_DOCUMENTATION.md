# Agent Flow Documentation

## 🎯 Core Logic Location

The agent's core decision-making logic is split across **3 main files**:

### 1. **Intent Classification** → `services/agentIntentClassifier.ts`

- **Purpose**: Analyzes user messages using Gemini AI to classify intent
- **Key Function**: `classifyIntent(userMessage, currentState, apiKey)`
- **Returns**: `UserIntent` object with type and extracted data

### 2. **Conversation Handler** → `services/conversationHandler.ts`

- **Purpose**: Main entry point that processes user queries and decides flow
- **Key Function**: `processMessage(userMessage, currentState, apiKey, automationMode)`
- **Returns**: `ConversationResponse` with message, state updates, and whether to run agent

### 3. **Agent Graph (LangGraph)** → `services/langgraph/agentGraph.ts`

- **Purpose**: State machine that executes the blog generation workflow
- **Key Function**: `runNext(state)` - executes next step in workflow
- **Routing Function**: `route(state)` - decides which node to execute next

---

## 📊 Complete Agent Flow Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER SENDS MESSAGE                            │
│              (via AgentMode.tsx → handleSend)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: INTENT CLASSIFICATION                                  │
│  File: services/agentIntentClassifier.ts                        │
│  Function: classifyIntent()                                     │
│                                                                  │
│  Uses Gemini AI to classify user message into:                  │
│  • greeting | help_request | off_topic                          │
│  • full_automation | partial_info | query                       │
│  • refinement | manual_control | approval | skip_step            │
│                                                                  │
│  Also extracts: topic, keywords, title, location                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: CONVERSATION HANDLER                                   │
│  File: services/conversationHandler.ts                          │
│  Function: processMessage()                                     │
│                                                                  │
│  Switch statement routes based on intent type:                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ greeting → handleGreeting()                               │  │
│  │   → Returns welcome message, no agent run                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ full_automation → handleFullAutomation()                  │  │
│  │   → Sets preferences.automationLevel = 'full'            │  │
│  │   → Sets autoFillFields = [keywords, title]              │  │
│  │   → Returns shouldRunAgent: true                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ partial_info → handlePartialInfo()                       │  │
│  │   → Extracts topic/keywords/title from message           │  │
│  │   → Updates state.data with extracted info                │  │
│  │   → Returns shouldRunAgent: true                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ query → handleQueryIntent()                               │  │
│  │   → Answers user question using Gemini                    │  │
│  │   → May trigger keyword research or title generation     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ refinement → handleRefinement()                          │  │
│  │   → Modifies existing agent state                        │  │
│  │   → Clears outline/draft for regeneration                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ approval → handleApproval()                              │  │
│  │   → Clears halt reason                                   │  │
│  │   → Returns shouldRunAgent: true                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: AGENT EXECUTION (if shouldRunAgent = true)              │
│  File: services/langgraph/agentGraph.ts                         │
│  Function: runNext(state)                                       │
│                                                                  │
│  The route() function decides next step:                        │
│                                                                  │
│  1. research_primary → researchPrimaryNode()                   │
│     • Fetches keyword ideas from Google Keyword Planner        │
│     • If automation: auto-selects best keyword                 │
│     • If guided: halts at 'await_keyword_selection'            │
│                                                                  │
│  2. research_secondary → researchSecondaryNode()              │
│     • Fetches secondary keyword candidates                      │
│     • If automation: auto-selects top 5                        │
│     • If guided: halts at 'await_secondary_selection'         │
│                                                                  │
│  3. title_generation → titleGenerationNode()                   │
│     • Generates 5-10 title options using Gemini                │
│     • If automation: auto-selects best title                   │
│     • If guided: halts at 'await_title_selection'              │
│                                                                  │
│  4. interlinking → interlinkingNode()                          │
│     • Prompts for internal/external links                       │
│     • If automation: skips (skipOptionalSteps: true)           │
│     • If guided: halts at 'await_interlinking'                │
│                                                                  │
│  5. references → referencesCollectionNode()                    │
│     • Prompts for reference URLs/files                          │
│     • If automation: skips (skipOptionalSteps: true)           │
│     • If guided: halts at 'await_references'                  │
│                                                                  │
│  6. discover → discoveryNode()                                  │
│     • Generates blog outline using Gemini                      │
│     • Uses references if provided                               │
│     • ALWAYS halts at 'awaiting_approval'                     │
│                                                                  │
│  7. await_approval → (waiting for user)                         │
│     • User must approve outline before continuing              │
│                                                                  │
│  8. proposal → proposalNode()                                   │
│     • Generates content section by section                     │
│     • Appends each section to draft                            │
│     • Continues until all sections done                        │
│     • Only halts if references_not_used                         │
│                                                                  │
│  9. final_blog → finalBlogGenerationNode()                     │
│     • Final formatting and cleanup                            │
│     • Marks finalBlogGenerated: true                          │
│                                                                  │
│  10. done → (workflow complete)                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 How Different User Queries Are Handled

### 1. **"Generate blog automatically"** or **"Handle it yourself"**

```
Intent: full_automation
→ handleFullAutomation()
→ Sets automationLevel: 'full'
→ Sets autoFillFields: [primaryKeyword, secondaryKeywords, title]
→ Sets skipOptionalSteps: true
→ Agent auto-selects all options, skips optional steps
→ Runs through workflow without halting for user input
```

### 2. **"Write about cloud computing"**

```
Intent: partial_info
→ handlePartialInfo()
→ Extracts topic: "cloud computing"
→ Updates state.data.topic
→ Returns shouldRunAgent: true
→ Agent starts from research_primary step
→ In guided mode: halts for keyword selection
→ In full mode: auto-selects everything
```

### 3. **"Change the title to 'AWS Guide'"**

```
Intent: refinement
→ handleRefinement()
→ Extracts title: "AWS Guide"
→ Updates state.data.title
→ Clears outline and draft
→ Returns shouldRunAgent: true
→ Agent regenerates outline with new title
```

### 4. **"Yes" or "Approve"** (when outline is shown)

```
Intent: approval
→ handleApproval()
→ Sets outlineApproved: true
→ Clears halt reason
→ Returns shouldRunAgent: true
→ Agent continues to proposal node
→ Starts generating blog content section by section
```

### 5. **"Can you suggest keywords?"**

```
Intent: query
→ handleQueryIntent()
→ Uses Gemini to answer question
→ May trigger keyword research if needed
→ Returns shouldRunAgent: true (if action required)
```

### 6. **"Skip this step"**

```
Intent: skip_step
→ handleSkipStep()
→ Marks current step as completed
→ Returns shouldRunAgent: true
→ Agent moves to next step
```

---

## 🎮 Automation Levels & Behavior

### **Full Automation** (`automationLevel: 'full'`)

- **Auto-selects**: Primary keyword, secondary keywords, title
- **Skips**: Interlinking, references (optional steps)
- **No halts**: Runs continuously until outline approval
- **After approval**: Generates all sections automatically

### **Guided Mode** (`automationLevel: 'guided'`)

- **Halts for**: Keyword selection, title selection
- **Skips**: Interlinking, references (optional)
- **User chooses**: Keywords and title from options
- **After approval**: Generates sections automatically

### **Manual Mode** (`automationLevel: 'manual'`)

- **Halts for**: Every decision point
- **User controls**: All selections
- **More interactive**: User approves each step

---

## 🔀 Key Decision Points

### **In Conversation Handler** (`conversationHandler.ts`)

- **Intent classification** determines which handler to call
- **Automation phrases** override intent to force full automation
- **Extracted data** (topic, keywords, title) updates agent state

### **In Agent Graph** (`agentGraph.ts`)

- **route() function** checks state and decides next node:
     - Missing primary keyword? → `research_primary`
     - Missing secondary keywords? → `research_secondary`
     - Missing title? → `title_generation`
     - Outline not approved? → `await_approval`
     - Sections remaining? → `proposal`
     - All done? → `done`

### **Automation Engine** (`automationEngine.ts`)

- **shouldAutoFill()** - Checks if field should be auto-selected
- **needsUserInput()** - Checks if agent should halt for user
- **isUserProvided()** - Checks if user explicitly provided value

---

## 📝 State Flow Example

### Example: User says "Write about AI in healthcare"

1. **Intent Classification**

      - Type: `partial_info`
      - Extracted: `topic: "AI in healthcare"`

2. **Conversation Handler**

      - Calls `handlePartialInfo()`
      - Updates `state.data.topic = "AI in healthcare"`
      - Returns `shouldRunAgent: true`

3. **Agent Graph - First Iteration**

      - `route()` checks: No primary keyword → `research_primary`
      - `researchPrimaryNode()` fetches keywords
      - If guided: Halts at `await_keyword_selection`
      - If full: Auto-selects best keyword, continues

4. **Agent Graph - Second Iteration**

      - `route()` checks: No secondary keywords → `research_secondary`
      - `researchSecondaryNode()` fetches secondary keywords
      - If guided: Halts at `await_secondary_selection`
      - If full: Auto-selects top 5, continues

5. **Agent Graph - Third Iteration**

      - `route()` checks: No title → `title_generation`
      - `titleGenerationNode()` generates titles
      - If guided: Halts at `await_title_selection`
      - If full: Auto-selects best title, continues

6. **Agent Graph - Fourth Iteration**

      - `route()` checks: No outline → `discover`
      - `discoveryNode()` generates outline
      - **ALWAYS halts** at `awaiting_approval` (user must approve)

7. **User Approves Outline**

      - Intent: `approval`
      - Sets `outlineApproved: true`
      - Agent continues to `proposal` node

8. **Agent Graph - Content Generation**

      - `proposalNode()` generates section 1, appends to draft
      - `proposalNode()` generates section 2, appends to draft
      - Continues until all sections done
      - Draft updates in real-time (section by section)

9. **Completion**
      - `finalBlogGenerationNode()` finalizes blog
      - Sets `finalBlogGenerated: true`
      - Returns `done`

---

## 🔍 Key Files Reference

| File                                | Purpose                        | Key Functions                                                                        |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `services/agentIntentClassifier.ts` | Classifies user intent         | `classifyIntent()`                                                                   |
| `services/conversationHandler.ts`   | Routes queries to handlers     | `processMessage()`, `handleFullAutomation()`, `handlePartialInfo()`                  |
| `services/langgraph/agentGraph.ts`  | Executes workflow steps        | `runNext()`, `route()`, `researchPrimaryNode()`, `discoveryNode()`, `proposalNode()` |
| `services/automationEngine.ts`      | Determines automation behavior | `shouldAutoFill()`, `needsUserInput()`, `isUserProvided()`                           |
| `services/dataExtractor.ts`         | Extracts data from messages    | `extractDataFromMessage()`                                                           |
| `services/queryHandler.ts`          | Handles user questions         | `handleQuery()`                                                                      |
| `components/AgentMode.tsx`          | UI orchestration               | `handleSend()` - calls conversation handler                                          |

---

## 🎯 Quick Reference: Query Types → Actions

| User Query                    | Intent            | Handler                  | Agent Action                           |
| ----------------------------- | ----------------- | ------------------------ | -------------------------------------- |
| "Generate blog automatically" | `full_automation` | `handleFullAutomation()` | Auto-selects all, skips optional steps |
| "Write about X"               | `partial_info`    | `handlePartialInfo()`    | Extracts topic, starts workflow        |
| "Change title to Y"           | `refinement`      | `handleRefinement()`     | Updates title, regenerates outline     |
| "Yes" / "Approve"             | `approval`        | `handleApproval()`       | Continues from halt point              |
| "Can you suggest keywords?"   | `query`           | `handleQueryIntent()`    | Answers + may trigger research         |
| "Skip this"                   | `skip_step`       | `handleSkipStep()`       | Marks step complete, continues         |
| "I want to choose"            | `manual_control`  | `handleManualControl()`  | Sets manual preferences                |
| "Hi" / "Hello"                | `greeting`        | `handleGreeting()`       | Returns welcome message                |

---

## 🔄 State Machine Flow (LangGraph)

```
START
  ↓
[route() checks state]
  ↓
┌─────────────────────────────────────┐
│ Missing Primary Keyword?             │
│ → research_primary                  │
│   → Fetches keywords                 │
│   → Auto-selects OR halts            │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Missing Secondary Keywords?         │
│ → research_secondary                │
│   → Fetches secondary keywords      │
│   → Auto-selects OR halts            │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Missing Title?                       │
│ → title_generation                   │
│   → Generates title options          │
│   → Auto-selects OR halts            │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Interlinking not completed?         │
│ → interlinking                      │
│   → Skips if automation             │
│   → Halts if guided                 │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ References not collected?           │
│ → references                        │
│   → Skips if automation             │
│   → Halts if guided                 │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ No Outline?                          │
│ → discover                          │
│   → Generates outline                │
│   → ALWAYS halts for approval        │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Outline Not Approved?                │
│ → await_approval                     │
│   → Waits for user                   │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Sections Remaining?                  │
│ → proposal                           │
│   → Generates section 1              │
│   → Generates section 2              │
│   → ... (continues until done)       │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ All Sections Done?                  │
│ → final_blog                        │
│   → Finalizes blog                   │
└─────────────────────────────────────┘
  ↓
DONE
```

---

## 💡 Important Notes

1. **Outline Approval is Always Required**: Even in full automation, user must approve the outline before content generation starts.

2. **Real-time Updates**: During `proposalNode()`, the draft is updated after each section, so content appears progressively.

3. **Automation Override**: If user says automation phrases, it overrides the UI automation level setting.

4. **State Persistence**: Agent state is maintained across messages, so the workflow can resume from any point.

5. **Halt Reasons**: Agent halts at specific points:
      - `await_keyword_selection` - Waiting for primary keyword
      - `await_secondary_selection` - Waiting for secondary keywords
      - `await_title_selection` - Waiting for title
      - `await_interlinking` - Waiting for links (optional)
      - `await_references` - Waiting for references (optional)
      - `awaiting_approval` - Waiting for outline approval
      - `references_not_used` - References weren't used in section
