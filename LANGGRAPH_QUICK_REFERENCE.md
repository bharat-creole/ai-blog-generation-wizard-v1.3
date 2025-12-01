# LangGraph Quick Reference

## 🚀 Quick Start

### What is LangGraph?
A stateful workflow engine that orchestrates multi-step blog generation with user interaction points.

### Core Components
- **Graph**: Workflow definition with nodes and routing
- **State**: Shared data structure flowing through nodes
- **Nodes**: Individual processing steps
- **Router**: Decides next node based on `currentStep`
- **Checkpointer**: Saves state for resumability

---

## 📋 Graph Nodes

| Node | Purpose | Input | Output | Halt? |
|------|---------|-------|--------|-------|
| `research_primary` | Find primary keywords | `topic` | `keywordCandidates` | Yes (if guided) |
| `research_secondary` | Find secondary keywords | `primaryKeyword` | `keywordCandidates` | Yes (if guided) |
| `title_generation` | Generate title options | `keywords` | `titleCandidates` | Yes (if guided) |
| `discovery` | Generate outline | `data + references` | `outline` | Yes (always) |
| `proposal` | Generate sections | `outline + sectionIndex` | `draft` (appended) | No |
| `final_blog` | Final polish | `draft` | `draft` (overwritten) | No |

---

## 🔀 Routing Rules

| currentStep | Condition | Routes To |
|-------------|-----------|-----------|
| `topic` | No topic | `__end__` |
| `topic` | Has topic | `research_primary` |
| `primary_keyword` | No keyword | `research_primary` |
| `primary_keyword` | Has keyword | `research_secondary` |
| `secondary_keywords` | No keywords | `research_secondary` |
| `secondary_keywords` | Has keywords | `title_generation` |
| `title` | No title | `title_generation` |
| `title` | Full automation | `discovery` |
| `title` | Guided mode | `__end__` (wait for optional) |
| `outline` | No outline | `discovery` |
| `outline` | Not approved | `__end__` |
| `outline` | Approved | `proposal` |
| `generation` | More sections | `proposal` |
| `generation` | All done | `__end__` |

---

## 📦 State Structure

```typescript
{
  // Core data
  data: {
    topic: string
    primaryKeyword: string
    secondaryKeywords: string[]
    title: string
    targetLocation: string
    referenceUrls: string[]
    interlinks: Interlink[]
  }
  
  // Workflow control
  currentStep: 'topic' | 'primary_keyword' | 'secondary_keywords' | 
               'title' | 'outline' | 'generation' | ...
  halt: { reason: string } | null
  
  // Generated content
  outline: OutlineSection[]
  draft: string
  outlineApproved: boolean
  
  // Progress
  progress: { sectionIndex: number }
  
  // Preferences
  preferences: {
    automationLevel: 'guided' | 'full'
    skipOptionalSteps: boolean
    autoSelectBestOptions: boolean
  }
  
  // UI candidates
  keywordCandidates: any[]
  titleCandidates: string[]
  
  // Debugging
  trace: Array<{ step: string; info?: any; at: number }>
}
```

---

## 🎯 Intent Types

| Intent | When | Action |
|--------|------|--------|
| `greeting` | "hi", "hello" | Return welcome message |
| `help_request` | "what can you do" | Show capabilities |
| `off_topic` | Unrelated question | Redirect to blog topic |
| `full_automation` | "generate automatically" | Set automation level |
| `partial_info` | Provides topic/keywords | Extract and update state |
| `refinement` | "change title" | Jump to step, clear field |
| `approval` | "yes", "proceed" | Clear halt, continue |
| `skip_step` | "skip this" | Move to next step |

---

## 🔄 API Flow

```
1. Frontend: POST /api/agent/message
   { message, threadId, currentState, stream: true }

2. Backend: processMessage()
   → classifyIntent()
   → handleIntent()
   → Returns: { assistantMessage, stateUpdates, shouldRunAgent }

3. If shouldRunAgent:
   → graph.stream(updatedState, config)
   → Streams: event: progress, event: complete

4. Frontend: onProgress()
   → Updates UI in real-time
   → Shows selection forms if halted
```

---

## 🛠️ Node Patterns

### Pattern 1: Research Node (with halt)
```typescript
if (userProvided) return { currentStep: '...' }
if (autoFill) return { data: { ... }, currentStep: '...' }
return {
  halt: { reason: 'await_selection' },
  candidates: [...],
  currentStep: '...'
}
```

### Pattern 2: Generation Node (no halt)
```typescript
const result = await generateContent(...)
return {
  draft: result,
  progress: { sectionIndex: idx + 1 },
  currentStep: 'generation'
}
```

### Pattern 3: Approval Node (always halts)
```typescript
const outline = await generateOutline(...)
return {
  outline,
  halt: { reason: 'awaiting_approval' },
  currentStep: 'outline'
}
```

---

## 🔑 Key Functions

### Router Function
```typescript
const route = (state: AgentState) => {
  if (state.halt) return '__end__'
  
  switch (state.currentStep) {
    case 'topic':
      return state.data.topic ? 'research_primary' : '__end__'
    // ... more cases
  }
}
```

### State Updates
```typescript
// Append (messages, trace)
reducer: (x, y) => x.concat(y)

// Merge (data, preferences)
reducer: (x, y) => ({ ...x, ...y })

// Overwrite (outline, draft)
reducer: (x, y) => y
```

---

## 🎬 Common Flows

### Flow 1: User Provides Topic
```
User: "Write about AI"
→ Intent: partial_info
→ State: { data: { topic: "AI" }, currentStep: 'topic' }
→ Router: research_primary
→ Node: Research keywords, halt for selection
```

### Flow 2: User Modifies Title
```
User: "Change the title"
→ Intent: refinement
→ State: { currentStep: 'title', data: { title: undefined } }
→ Router: title_generation
→ Node: Regenerate titles, halt for selection
```

### Flow 3: Full Automation
```
User: "Generate blog automatically"
→ Intent: full_automation
→ Preferences: { automationLevel: 'full' }
→ Nodes: Auto-select keywords, title
→ Skip optional steps
→ Generate outline (still requires approval)
```

---

## 🐛 Debugging Tips

### Check State
```typescript
console.log('Current Step:', state.currentStep)
console.log('Halt Reason:', state.halt?.reason)
console.log('Has Topic:', !!state.data.topic)
console.log('Progress:', state.progress)
```

### Check Routing
```typescript
// In route() function
console.log(`📍 Current Step: ${state.currentStep}`)
console.log(`   → Route: ${nextNode}`)
```

### Check Node Execution
```typescript
// In node function
console.log(`🔍 [NODE] Executing...`)
console.log(`   Input:`, { topic: state.data.topic })
console.log(`   Output:`, { halt: state.halt })
```

---

## 📁 File Structure

```
server/agent/
├── graph.ts              # Graph definition + router
├── state.ts              # State schema
├── conversationHandler.ts # Intent handling
├── intentClassifier.ts   # AI intent classification
├── checkpointer.ts       # State persistence
└── nodes/
    ├── research.ts       # Keyword research nodes
    ├── planning.ts       # Title + outline nodes
    └── generation.ts    # Content generation nodes

components/agentComponents/
├── hooks/
│   └── useAgentExecutionV3.ts  # Frontend API client
└── ...

server/index.ts           # API endpoints
```

---

## 🎯 Best Practices

1. **Always check `halt` first** in router
2. **Use `currentStep` for navigation** (not just data presence)
3. **Clear dependent fields** when parent changes
4. **Stream state updates** for real-time UI
5. **Save checkpoints** for resumability
6. **Handle all intent types** in conversation handler
7. **Provide fallbacks** for API failures

---

## 🔗 Related Files

- **Main Guide**: `LANGGRAPH_IMPLEMENTATION_GUIDE.md`
- **Visual Flow**: `LANGGRAPH_VISUAL_FLOW.md`
- **Graph Definition**: `server/agent/graph.ts`
- **State Schema**: `server/agent/state.ts`
- **API Endpoint**: `server/index.ts` (line 412)
- **Frontend Hook**: `components/agentComponents/hooks/useAgentExecutionV3.ts`

---

## 💡 Quick Tips

- **Bidirectional navigation**: Change `currentStep` + clear field → router handles it
- **Automation**: Set `preferences.automationLevel = 'full'` + `autoFillFields`
- **Halt reasons**: Use consistent naming (`await_keyword_selection`, etc.)
- **State persistence**: Thread ID tracks conversation across requests
- **Streaming**: Use Server-Sent Events (SSE) for real-time updates

---

**For detailed explanations, see `LANGGRAPH_IMPLEMENTATION_GUIDE.md`**


