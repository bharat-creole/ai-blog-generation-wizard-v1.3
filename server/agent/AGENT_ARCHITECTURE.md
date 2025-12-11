# Agent Architecture - Primary Router + Context Manager

## Overview

This implementation uses **two agents** working together:

1. **Primary Router Agent** (Option-1) - Stateless router
2. **Context Manager Agent** (Option-4) - Reads history & state when needed

## Architecture Flow

```
User Message
    ↓
🛡️ Primary Router Agent (Stateless)
    ├─→ Analyzes message type
    ├─→ Normalizes input
    └─→ Routes to appropriate handler
    ↓
    ├─→ shouldProceed: false → Return Direct Response ✅
    ├─→ systemAction: "restart" → Reset State → Return ✅
    ├─→ systemAction: "route_to_context_manager" → Context Manager Agent 📚
    └─→ systemAction: "route_to_intent_classifier" → Normal Blog Flow ➡️
```

## Primary Router Agent

**File:** `server/agent/primaryAgent.ts`

**Purpose:** Stateless routing - classifies messages and routes appropriately

**Responsibilities:**
- Classify message type (blog_creation_request, meta_instruction, context_query, etc.)
- Normalize user input (remove greetings, filler words)
- Decide routing action
- Does NOT read history or manage memory

**Message Types:**
- `blog_creation_request` - User wants to create/continue blog
- `meta_instruction` - User wants to restart/reset
- `context_query` - User asking about previous conversation
- `general_question` - Questions about the tool
- `off_topic` - Completely unrelated topics
- `abusive_or_invalid` - Spam, gibberish, inappropriate
- `irrelevant_small_talk` - Just greetings without purpose

**System Actions:**
- `restart` - Reset flow
- `abort` - Do not proceed (return direct response)
- `route_to_intent_classifier` - Normal blog flow
- `route_to_context_manager` - Handle context queries

## Context Manager Agent

**File:** `server/agent/contextManagerAgent.ts`

**Purpose:** Handles questions ABOUT the conversation itself

**Responsibilities:**
- Reads full AgentState (messages, topic, keywords, etc.)
- Answers questions about previous conversation
- Grounded in provided state (doesn't invent)
- Examples:
  - "What was my previous question?"
  - "What topic did I give earlier?"
  - "What did you suggest before?"

**When Used:**
- Only when Primary Router routes with `route_to_context_manager`
- Does NOT trigger LangGraph execution
- Returns direct response based on conversation history

## Integration in API Handler

**File:** `server/index.ts`

### Flow Steps:

1. **Primary Router** - Analyzes message
   ```typescript
   const primaryAgent = new PrimaryAgent(apiKey);
   const routing = await primaryAgent.analyzeMessage(message, currentState);
   ```

2. **Check shouldProceed** - If false, return direct response
   ```typescript
   if (!routing.shouldProceed) {
       return res.json({ assistantMessage: routing.directResponse });
   }
   ```

3. **Handle restart** - Reset state if needed
   ```typescript
   if (routing.systemAction === 'restart') {
       // Reset state and return
   }
   ```

4. **Handle context query** - Route to Context Manager
   ```typescript
   if (routing.systemAction === 'route_to_context_manager') {
       const contextAgent = new ContextManagerAgent(apiKey);
       const response = await contextAgent.handleContextQuery(
           routing.normalizedMessage,
           currentState
       );
       return res.json({ assistantMessage: response.assistantMessage });
   }
   ```

5. **Normal blog flow** - Continue to Intent Classifier
   ```typescript
   // Use normalized message
   const response = await processMessage(
       routing.normalizedMessage,
       currentState,
       apiKey
   );
   // Continue with LangGraph if needed
   ```

## Key Benefits

1. **Separation of Concerns**
   - Router = Stateless routing
   - Context Manager = State-aware queries
   - LangGraph = Single source of truth for state

2. **Cost Efficiency**
   - Blocks invalid input early (before expensive LLM calls)
   - Context queries don't trigger full graph execution

3. **Better UX**
   - Faster responses for simple queries
   - Handles context questions naturally
   - Clean restart functionality

4. **Maintainability**
   - Clear routing logic
   - Easy to extend with new routes
   - Context handling isolated

## Example Scenarios

### Scenario 1: Blog Creation Request
```
Input: "Hi, write about cloud computing"
→ Primary Router: type="blog_creation_request", normalized="write about cloud computing"
→ Action: route_to_intent_classifier
→ Continues to Intent Classifier → Conversation Handler → LangGraph
```

### Scenario 2: Context Query
```
Input: "What was my previous question?"
→ Primary Router: type="context_query"
→ Action: route_to_context_manager
→ Context Manager: Reads message history, finds last user question
→ Returns: "Your previous question was: 'write about cloud computing'"
→ NO LangGraph execution
```

### Scenario 3: Restart Request
```
Input: "Start over"
→ Primary Router: type="meta_instruction"
→ Action: restart
→ Resets state (clears topic, keywords, outline, etc.)
→ Returns: "Okay, let's start fresh. Tell me the topic..."
→ NO LangGraph execution
```

### Scenario 4: Off-Topic
```
Input: "What's the weather?"
→ Primary Router: type="off_topic"
→ shouldProceed: false
→ Returns: "I'm focused on helping you create blog content..."
→ NO further processing
```

## Files Structure

```
server/agent/
├── primaryAgent.ts          # Primary Router Agent (stateless)
├── contextManagerAgent.ts  # Context Manager Agent (state-aware)
├── conversationHandler.ts   # Existing conversation handler
├── intentClassifier.ts      # Existing intent classifier
└── graph.ts                 # LangGraph workflow
```

## Summary

- **Primary Router** = Stateless, routes messages
- **Context Manager** = State-aware, handles context queries
- **LangGraph** = Single source of truth for blog generation state
- **Clean separation** = Each agent has a specific role
- **Cost efficient** = Early filtering and targeted processing

