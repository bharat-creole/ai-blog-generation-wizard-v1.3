# 🤖 Agent Flow - Visual Diagram

## Simplified Flow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                              │
│                                                                   │
│  User types message → AgentMode.tsx → handleSend()              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND: Intent Analysis                            │
│                                                                   │
│  • Detects: "generate blog", "automatically", etc.              │
│  • If no topic → Ask user                                        │
│  • If topic → Initialize state                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND: /api/agent/message                         │
│                                                                   │
│  POST with: message, threadId, currentState                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STEP 1: Intent Classification                       │
│              (intentClassifier.ts)                                │
│                                                                   │
│  Gemini AI analyzes message → Returns UserIntent                 │
│                                                                   │
│  Types: greeting | help | full_automation | partial_info |     │
│         refinement | approval | skip_step                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STEP 2: Conversation Handler                        │
│              (conversationHandler.ts)                             │
│                                                                   │
│  Routes intent to handler:                                       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ full_automation → Sets automationLevel: 'full'            │  │
│  │                → Sets autoFillFields                      │  │
│  │                → Returns shouldRunAgent: true             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ partial_info → Extracts topic/keywords/title              │  │
│  │             → Updates state.data                          │  │
│  │             → Sets currentStep                             │  │
│  │             → Returns shouldRunAgent: true                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ refinement → Detects field to modify                     │  │
│  │           → Clears dependent fields                      │  │
│  │           → Jumps to appropriate step                     │  │
│  │           → Returns shouldRunAgent: true                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ approval → Sets outlineApproved: true                     │  │
│  │         → Clears halt                                   │  │
│  │         → Returns shouldRunAgent: true                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼ (if shouldRunAgent = true)
┌─────────────────────────────────────────────────────────────────┐
│              STEP 3: LangGraph Execution                         │
│              (graph.ts → route function)                         │
│                                                                   │
│  Router checks currentStep and routes to next node:              │
│                                                                   │
│  currentStep: 'topic' → research_primary                         │
│  currentStep: 'primary_keyword' → research_secondary            │
│  currentStep: 'secondary_keywords' → title_generation           │
│  currentStep: 'title' → discovery (or wait)                     │
│  currentStep: 'outline' → proposal (if approved)                │
│  currentStep: 'generation' → proposal (if sections remain)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STEP 4: Node Execution                              │
│              (nodes/*.ts)                                        │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ research_primary                                          │  │
│  │   • Fetches keywords from Google Ads API                 │  │
│  │   • If automation: Auto-selects best                      │  │
│  │   • If guided: Halts → await_keyword_selection            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ research_secondary                                        │  │
│  │   • Fetches secondary keywords                            │  │
│  │   • Filters out primary keyword                           │  │
│  │   • If automation: Auto-selects top 5                    │  │
│  │   • If guided: Halts → await_secondary_selection         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ title_generation                                          │  │
│  │   • Generates 5-10 titles using Gemini                   │  │
│  │   • If automation: Auto-selects best                      │  │
│  │   • If guided: Halts → await_title_selection             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ discovery (outline generation)                             │  │
│  │   • Generates outline using Gemini                        │  │
│  │   • Uses references if provided                           │  │
│  │   • ALWAYS halts → awaiting_approval                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ proposal (content generation)                             │  │
│  │   • Generates section 1 → Appends to draft               │  │
│  │   • Generates section 2 → Appends to draft               │  │
│  │   • Continues until all sections done                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ final_blog                                                │  │
│  │   • Final formatting and polish                           │  │
│  │   • Marks complete                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STEP 5: State Updates (SSE Stream)                  │
│                                                                   │
│  Server-Sent Events:                                             │
│  • event: intent → Initial response                             │
│  • event: progress → State updates from nodes                    │
│  • event: done → Final state                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              STEP 6: Frontend State Sync                        │
│                                                                   │
│  Updates:                                                         │
│  • agent state                                                  │
│  • outline                                                      │
│  • draft (blog content)                                         │
│  • messages                                                     │
│  • UI metadata (selections, forms)                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Machine Flow

```
                    START
                      │
                      ▼
              ┌───────────────┐
              │    topic      │ ← User provides topic
              └───────┬───────┘
                      │
                      ▼
        ┌─────────────────────────┐
        │  research_primary        │
        │  • Fetch keywords        │
        │  • Auto-select OR halt   │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  research_secondary      │
        │  • Fetch keywords        │
        │  • Auto-select OR halt   │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  title_generation        │
        │  • Generate titles      │
        │  • Auto-select OR halt  │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  discovery               │
        │  • Generate outline      │
        │  • ALWAYS halt           │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  awaiting_approval       │ ← User must approve
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  proposal               │
        │  • Section 1            │
        │  • Section 2            │
        │  • ... (loop)           │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │  final_blog             │
        │  • Final polish         │
        └───────────┬─────────────┘
                    │
                    ▼
                   DONE
```

---

## Decision Points

```
┌─────────────────────────────────────────────────────────────┐
│                    DECISION POINT: Automation?                 │
│                                                                 │
│  Full Automation:                                              │
│    → Auto-select keywords                                      │
│    → Auto-select title                                         │
│    → Skip optional steps                                       │
│    → Run until outline approval                                │
│                                                                 │
│  Guided Mode:                                                  │
│    → Halt for keyword selection                                │
│    → Halt for title selection                                  │
│    → Skip optional steps                                       │
│    → Run until outline approval                                │
│                                                                 │
│  Manual Mode:                                                   │
│    → Halt at every step                                        │
│    → User controls all                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Halt Points (User Input Required)

```
┌─────────────────────────────────────────────────────────────┐
│  await_keyword_selection                                      │
│    → User must select primary keyword from options           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  await_secondary_selection                                    │
│    → User must select secondary keywords from options        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  await_title_selection                                        │
│    → User must select title from options                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  awaiting_approval                                            │
│    → User must approve outline (ALWAYS required)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Bidirectional Navigation (Modifications)

```
User: "Change the title to X"
  ↓
Intent: refinement (title)
  ↓
Conversation Handler:
  • Detects title modification
  • Clears outline (depends on title)
  • Sets currentStep: 'title'
  • Sets data.title: 'X'
  ↓
Graph Router:
  • Sees currentStep: 'title'
  • Sees title exists
  • Routes to discovery
  ↓
Discovery Node:
  • Generates new outline with new title
  • Halts for approval
```

---

## Example: Full Automation Flow

```
1. User: "Generate blog automatically about AI"
   ↓
2. Frontend: Detects automation + topic
   ↓
3. Backend: Intent = full_automation
   ↓
4. Handler: Sets automationLevel = 'full'
   ↓
5. Graph: research_primary
   → Auto-selects keyword
   ↓
6. Graph: research_secondary
   → Auto-selects top 5 keywords
   ↓
7. Graph: title_generation
   → Auto-selects title
   ↓
8. Graph: discovery
   → Generates outline
   → Halts for approval
   ↓
9. User: "Yes, approve"
   ↓
10. Graph: proposal
    → Generates section 1
    → Generates section 2
    → ... (all sections)
    ↓
11. Graph: final_blog
    → Final polish
    → Complete!
```

---

## Example: Guided Mode with Modification

```
1. User: "Write about cloud computing"
   ↓
2. Backend: Intent = partial_info
   → Extracts topic
   ↓
3. Graph: research_primary
   → Fetches keywords
   → Halts for selection
   ↓
4. User: Selects keyword
   ↓
5. Graph: research_secondary
   → Fetches keywords
   → Halts for selection
   ↓
6. User: Selects keywords
   ↓
7. Graph: title_generation
   → Generates titles
   → Halts for selection
   ↓
8. User: "Change title to 'AWS Guide'"
   ↓
9. Backend: Intent = refinement
   → Clears outline
   → Sets currentStep = 'title'
   → Sets title = 'AWS Guide'
   ↓
10. Graph: discovery
    → Generates new outline
    → Halts for approval
    ↓
11. User: "Approve"
    ↓
12. Graph: proposal
    → Generates content
    → Complete!
```

---

## Key Files Reference

| Component | File | Purpose |
|-----------|------|---------|
| **Frontend** | `components/AgentMode.tsx` | Main UI orchestrator |
| **Frontend** | `components/agentComponents/hooks/useAgentExecutionV3.ts` | Backend communication |
| **Backend** | `server/agent/intentClassifier.ts` | Intent classification |
| **Backend** | `server/agent/conversationHandler.ts` | Message processing |
| **Backend** | `server/agent/graph.ts` | LangGraph state machine |
| **Backend** | `server/agent/state.ts` | State schema |
| **Backend** | `server/agent/nodes/research.ts` | Keyword research |
| **Backend** | `server/agent/nodes/planning.ts` | Title & outline generation |
| **Backend** | `server/agent/nodes/generation.ts` | Content generation |
| **API** | `server/index.ts` | Express endpoints |

---

*This is a simplified visual guide. For detailed implementation, see `AGENT_IMPLEMENTATION_GUIDE.md`*

