# LangGraph Visual Flow Diagrams

## 🎯 Complete Workflow Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER SENDS MESSAGE                           │
│              "Write about cloud computing"                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND: useAgentExecutionV3                      │
│  - Maps state to backend format                                 │
│  - Calls streamMessage() API                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│         BACKEND: /api/agent/message                             │
│  POST { message, threadId, currentState, stream: true }          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│         CONVERSATION HANDLER                                     │
│  processMessage()                                                │
│    ↓                                                             │
│  classifyIntent() → Gemini AI classifies message                │
│    ↓                                                             │
│  handlePartialInfo() → Extracts topic, updates state            │
│    ↓                                                             │
│  Returns: { assistantMessage, stateUpdates, shouldRunAgent }     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
                    shouldRunAgent = true?
                            │
                            ▼ YES
┌─────────────────────────────────────────────────────────────────┐
│              LANGGRAPH EXECUTION                                │
│  graph.stream(updatedState, { thread_id })                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ROUTER FUNCTION                               │
│  route(state) → Decides next node                                │
│  Based on: currentStep, state conditions                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
                    ┌───────┴───────┐
                    │               │
                    ▼               ▼
            ┌──────────────┐  ┌──────────────┐
            │   NODE 1     │  │   NODE 2     │
            │  research_   │  │  research_   │
            │  primary     │  │  secondary   │
            └──────┬───────┘  └──────┬───────┘
                   │                 │
                   └────────┬────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │   NODE 3     │
                    │  title_      │
                    │  generation  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   NODE 4     │
                    │  discovery   │
                    │  (outline)   │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   NODE 5     │
                    │  proposal    │
                    │  (sections)  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   NODE 6     │
                    │  final_blog  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   __end__    │
                    └──────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STATE UPDATES STREAMED                             │
│  event: progress → { nodeName: { ...state } }                  │
│  event: complete → { state: finalState }                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND: onProgress()                             │
│  - Updates draft in real-time                                   │
│  - Shows progress messages                                      │
│  - Updates UI components                                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UI UPDATES                                   │
│  - Chat messages                                                │
│  - Blog content display                                         │
│  - Selection forms (if halted)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔀 Graph Node Flow

```
                    ┌─────────────┐
                    │  __start__  │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   route()   │
                    │  (Router)   │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ research_     │  │ research_     │  │ title_        │
│ primary       │  │ secondary     │  │ generation    │
│               │  │               │  │               │
│ - Get topic   │  │ - Use primary │  │ - Use keywords│
│ - Call API    │  │ - Call API    │  │ - Call Gemini │
│ - Rank        │  │ - Filter      │  │ - Generate    │
│ - Halt/Select │  │ - Halt/Select │  │ - Halt/Select │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   route()   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  discovery  │
                    │             │
                    │ - Use data  │
                    │ - Call AI   │
                    │ - Generate  │
                    │   outline   │
                    │ - Halt for  │
                    │   approval  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   route()   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  proposal   │
                    │             │
                    │ - Loop:     │
                    │   Section 0 │
                    │   Section 1 │
                    │   Section 2 │
                    │   ...       │
                    │ - Build     │
                    │   draft     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   route()   │
                    └──────┬───────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  __end__    │
                    └─────────────┘
```

---

## 📊 State Flow Through Nodes

```
Initial State:
{
  currentStep: 'topic',
  data: { topic: 'cloud computing' },
  halt: null
}
        │
        ▼
┌─────────────────────────────────────┐
│  researchPrimaryNode                │
│  Input:  { topic: 'cloud computing' }│
│  Output: {                          │
│    keywordCandidates: [...],        │
│    halt: { reason: 'await_keyword...'│
│    currentStep: 'primary_keyword'    │
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
User Selects Keyword
        │
        ▼
┌─────────────────────────────────────┐
│  State Updated:                     │
│  {                                  │
│    data: { primaryKeyword: '...' }, │
│    currentStep: 'primary_keyword',  │
│    halt: null                       │
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  researchSecondaryNode               │
│  Input:  { primaryKeyword: '...' }   │
│  Output: {                           │
│    keywordCandidates: [...],        │
│    halt: { reason: 'await_secondary'│
│    currentStep: 'secondary_keywords' │
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
... (continues through all nodes)
```

---

## 🎯 Routing Decision Tree

```
route(state)
│
├─► IF halt exists
│   └─► return '__end__'  (Wait for user)
│
├─► IF currentStep === 'topic'
│   ├─► IF !data.topic
│   │   └─► return '__end__'  (Wait for topic)
│   └─► ELSE
│       └─► return 'research_primary'
│
├─► IF currentStep === 'primary_keyword'
│   ├─► IF !data.primaryKeyword
│   │   └─► return 'research_primary'
│   └─► ELSE
│       └─► return 'research_secondary'
│
├─► IF currentStep === 'secondary_keywords'
│   ├─► IF !data.secondaryKeywords
│   │   └─► return 'research_secondary'
│   └─► ELSE
│       └─► return 'title_generation'
│
├─► IF currentStep === 'title'
│   ├─► IF !data.title
│   │   └─► return 'title_generation'
│   ├─► IF automationLevel === 'full'
│   │   └─► return 'discovery'  (Skip optional)
│   └─► ELSE
│       └─► return '__end__'  (Wait for optional steps)
│
├─► IF currentStep === 'outline'
│   ├─► IF !outline.length
│   │   └─► return 'discovery'
│   ├─► IF !outlineApproved
│   │   └─► return '__end__'  (Wait for approval)
│   └─► ELSE
│       └─► return 'proposal'
│
└─► IF currentStep === 'generation'
    ├─► IF sectionIndex < outline.length
    │   └─► return 'proposal'  (More sections)
    └─► ELSE
        └─► return '__end__'  (Complete!)
```

---

## 🔄 Bidirectional Navigation Example

```
User: "Change the title"
        │
        ▼
┌─────────────────────────────────────┐
│  Conversation Handler               │
│  Intent: refinement                 │
│  Detects: modification request      │
│  Updates: {                         │
│    currentStep: 'title',            │
│    data: { title: undefined },      │
│    outline: [],                     │
│    halt: null                       │
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Router                              │
│  Sees: currentStep === 'title'      │
│        && !data.title               │
│  Routes to: 'title_generation'      │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  titleGenerationNode                │
│  Regenerates title options           │
│  Output: {                           │
│    titleCandidates: [...],           │
│    halt: { reason: 'await_title...' }│
│  }                                  │
└─────────────────────────────────────┘
        │
        ▼
Frontend shows title selection UI
```

---

## 🎬 Complete Example: Full Automation Flow

```
User: "Generate blog about AI automatically"
        │
        ▼
Intent: full_automation
        │
        ▼
State: {
  data: { topic: 'AI' },
  preferences: { automationLevel: 'full' },
  autoFillFields: ['primaryKeyword', 'secondaryKeywords', 'title']
}
        │
        ▼
┌─────────────────────────────────────┐
│  researchPrimaryNode                │
│  → Auto-selects best keyword        │
│  → No halt                          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  researchSecondaryNode              │
│  → Auto-selects top 5 keywords      │
│  → No halt                          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  titleGenerationNode                │
│  → Auto-selects first title         │
│  → No halt                          │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  discoveryNode                      │
│  → Generates outline                │
│  → Halt for approval (required)     │
└─────────────────────────────────────┘
        │
        ▼
User: "Yes, proceed"
        │
        ▼
┌─────────────────────────────────────┐
│  proposalNode (loop)                 │
│  → Section 0                        │
│  → Section 1                        │
│  → Section 2                        │
│  → ...                              │
│  → All sections complete            │
└─────────────────────────────────────┘
        │
        ▼
Complete! Blog ready.
```

---

## 🔑 Key Concepts Visualized

### State Reducers

```
APPEND (messages, trace):
  [msg1, msg2] + [msg3] = [msg1, msg2, msg3]

MERGE (data, preferences):
  { a: 1, b: 2 } + { b: 3, c: 4 } = { a: 1, b: 3, c: 4 }

OVERWRITE (outline, draft):
  "old draft" → "new draft" (replaces completely)
```

### Halt Mechanism

```
Node Execution:
  ┌─────────────┐
  │   Node      │
  │             │
  │  Returns:   │
  │  {          │
  │    halt: {  │
  │      reason:│
  │      'await_│
  │      keyword│
  │      ...'   │
  │    }        │
  │  }          │
  └──────┬──────┘
         │
         ▼
  Router sees halt
         │
         ▼
  Returns '__end__'
         │
         ▼
  Graph pauses
         │
         ▼
  Frontend shows UI
  (keyword selection)
         │
         ▼
  User selects
         │
         ▼
  State updated:
  { halt: null }
         │
         ▼
  Graph resumes
```

### Checkpointing

```
Thread ID: "thread-1234567890"
        │
        ▼
┌─────────────────────────────────────┐
│  FileCheckpointer                   │
│  Saves to:                          │
│  server/data/checkpoints/           │
│    thread-1234567890.json           │
│                                     │
│  Contains:                          │
│  - checkpoint (state snapshot)      │
│  - metadata                         │
│  - parentCheckpointId               │
└─────────────────────────────────────┘
        │
        ▼
On resume:
  Load checkpoint
  Continue from saved state
```

---

## 📱 Frontend Component Structure

```
AgentMode.tsx
│
├─► useAgentState() → Manages all local state
│
├─► useAgentExecutionV3() → Handles API calls
│   ├─► sendUserMessage() → Main entry point
│   └─► streamMessage() → Handles streaming
│
├─► ChatInterface → Displays messages
│
├─► BlogContentDisplay → Shows draft content
│
├─► Selection Components:
│   ├─► PrimaryKeywordSelection
│   ├─► SecondaryKeywordSelection
│   ├─► TitleSelection
│   ├─► ReferencesForm
│   └─► InterlinkingForm
│
└─► Panels:
    ├─► BlogInfoPanel
    ├─► TracePanel
    └─► SettingsPanel
```

---

This visual guide complements the detailed explanation in `LANGGRAPH_IMPLEMENTATION_GUIDE.md`.


