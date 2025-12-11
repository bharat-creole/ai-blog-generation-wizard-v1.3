# Primary Agent - Usage Guide

## Overview

The Primary Agent acts as a **guardian/router** that runs **BEFORE** the intent classifier. It:
- Detects message types
- Normalizes user input
- Routes messages appropriately
- Handles restarts and blocks invalid input

## Flow

```
User Message
    ↓
Primary Agent (Guardian/Router)
    ↓
    ├─→ Should Proceed? NO → Return Direct Response
    ├─→ System Action: RESTART → Reset State → Continue
    └─→ System Action: ROUTE → Use Normalized Message → Intent Classifier
```

## Message Types Detected

1. **blog_creation_request** - User wants to create/continue blog
2. **meta_instruction** - User wants to restart/reset (e.g., "start over")
3. **general_question** - Questions about the tool
4. **off_topic** - Completely unrelated topics
5. **abusive_or_invalid** - Spam, gibberish, inappropriate content
6. **irrelevant_small_talk** - Just greetings without purpose

## Examples

### Example 1: Blog Creation Request
```
Input: "Hi, write about cloud computing"
Primary Agent:
  - Type: blog_creation_request
  - Normalized: "write about cloud computing"
  - Should Proceed: true
  - Action: route_to_intent_classifier
→ Continues to Intent Classifier
```

### Example 2: Restart Request
```
Input: "Start over"
Primary Agent:
  - Type: meta_instruction
  - Normalized: "start over"
  - Should Proceed: true
  - Action: restart
→ Resets state, then continues
```

### Example 3: General Question
```
Input: "What can you do?"
Primary Agent:
  - Type: general_question
  - Should Proceed: false
  - Action: abort
  - Direct Response: "I help you create SEO-optimized blog posts..."
→ Returns response immediately, no further processing
```

### Example 4: Off-Topic
```
Input: "What's the weather?"
Primary Agent:
  - Type: off_topic
  - Should Proceed: false
  - Action: abort
  - Direct Response: "I'm focused on helping you create blog content..."
→ Returns response immediately
```

### Example 5: Invalid Input
```
Input: "asdfghjkl"
Primary Agent:
  - Type: abusive_or_invalid
  - Should Proceed: false
  - Action: abort
  - Direct Response: "I couldn't understand your message..."
→ Returns response immediately
```

## Integration

The Primary Agent is automatically integrated in `server/index.ts`:

```typescript
// Step 0: Primary Agent
const primaryAgent = new PrimaryAgent(apiKey);
const analysis = await primaryAgent.analyzeMessage(message, currentState);

if (!analysis.shouldProceed) {
    // Return direct response
    return res.json({ assistantMessage: analysis.directResponse });
}

if (analysis.systemAction === 'restart') {
    // Reset state and continue
}

// Use normalized message for intent classification
const response = await processMessage(analysis.normalizedMessage, ...);
```

## Benefits

1. **Early Filtering** - Blocks invalid input before expensive LLM calls
2. **Message Normalization** - Cleans input before processing
3. **Cost Savings** - Avoids unnecessary intent classification calls
4. **Better UX** - Faster responses for simple queries
5. **State Management** - Handles restart/reset logic cleanly

