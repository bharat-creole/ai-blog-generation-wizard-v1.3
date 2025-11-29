# Agent Behavior Configuration Guide

This guide shows you where to modify different aspects of the agent's behavior.

## 📁 Key Files for Agent Behavior

### 1. **Conversation Handler** - Main Behavior Logic
**File:** `server/agent/conversationHandler.ts`

This is the **PRIMARY** file for changing agent behavior. It handles:
- ✅ User message processing
- ✅ Response messages
- ✅ Flow control
- ✅ Confirmation prompts
- ✅ Missing information detection

#### Key Functions to Modify:

**`handleGreeting()`** (Line ~183)
- Initial greeting message
- What information to request upfront
- How to handle returning users

**`handlePartialInfo()`** (Line ~372)
- How to process user-provided information
- Validation logic
- Missing information detection
- Next step suggestions

**`handleOffTopic()`** (Line ~297)
- How to redirect off-topic queries
- What to ask when user goes off-track

**`handleRefinement()`** (Line ~582)
- Modification request handling
- Confirmation prompts
- Step redo warnings

**`handleApproval()`** (Line ~810)
- How to handle user confirmations
- Auto-selection confirmations
- Outline approvals

**`handleFullAutomation()`** (Line ~341)
- Automation mode behavior
- Auto-selection settings

**Helper Functions:**
- `getMissingInformation()` - What info is missing
- `getCurrentRequiredStep()` - Next step in sequence
- `validateInformation()` - Data validation rules

---

### 2. **Intent Classifier** - Understanding User Intent
**File:** `server/agent/intentClassifier.ts`

Controls how the agent interprets user messages.

**Key Section:** The prompt (Line ~66)
- Classification rules
- Intent priority order
- Data extraction patterns
- Examples of each intent type

**To Change:**
- Add new intent types
- Modify classification rules
- Change extraction patterns
- Update examples

---

### 3. **Graph Router** - Execution Flow
**File:** `server/agent/graph.ts`

Controls the execution flow and step routing.

**Key Function:** `route()` (Line ~11)
- Determines next step based on current state
- Step sequence logic
- Automation vs guided mode routing

**To Change:**
- Modify step sequence
- Change routing conditions
- Add new steps
- Change automation behavior

---

### 4. **Node Handlers** - Step-Specific Behavior
**Directory:** `server/agent/nodes/`

#### `research.ts` - Keyword Research
- Primary keyword research logic
- Secondary keyword research logic
- Auto-selection behavior
- Confirmation prompts after auto-selection

**Key Functions:**
- `researchPrimaryNode()` - Primary keyword research
- `researchSecondaryNode()` - Secondary keyword research

#### `planning.ts` - Title & Outline Generation
- Title generation logic
- Outline generation logic
- Auto-selection behavior

**Key Functions:**
- `titleGenerationNode()` - Title generation
- `discoveryNode()` - Outline generation

#### `generation.ts` - Content Generation
- Blog content generation
- Section-by-section writing

---

### 5. **State Management** - Agent State Structure
**File:** `server/agent/state.ts`

Defines the agent's state structure and data model.

**Key Section:** `AgentStateAnnotation` (Line ~19)
- Available state fields
- Data types
- Default values
- Halt reasons

**To Change:**
- Add new state fields
- Modify halt reasons
- Change data structures

---

### 6. **Message Generation** - Frontend Messages
**File:** `components/agentComponents/hooks/useAgentExecutionV3.ts`

Controls how messages are displayed to users.

**Key Section:** `onComplete` handler (Line ~180)
- Message enhancement
- Component metadata
- Guidance messages

**File:** `server/index.ts` (Line ~511)
- Server-side message enhancement
- Halt reason messages

---

### 7. **Automation Engine** - Auto-Selection Logic
**File:** `services/automationEngine.ts`

Controls when and how auto-selection happens.

**Key Functions:**
- `shouldAutoFill()` - When to auto-select
- `isUserProvided()` - Check if user provided value

---

## 🎯 Common Behavior Changes

### Change Initial Greeting
**File:** `server/agent/conversationHandler.ts`
**Function:** `handleGreeting()` (Line ~183)

```typescript
return {
    assistantMessage: "Your custom greeting message here...",
    stateUpdates: {},
    shouldRunAgent: false,
};
```

### Change Confirmation Messages
**File:** `server/agent/conversationHandler.ts`
**Function:** `handleRefinement()` (Line ~582)

Look for messages like:
```typescript
assistantMessage: `⚠️ **Important Notice**\n\nChanging the ${field} will require...`
```

### Change Missing Information Detection
**File:** `server/agent/conversationHandler.ts`
**Function:** `getMissingInformation()` (Line ~195)

Add/remove fields to check:
```typescript
if (!state.data.yourField?.trim()) {
    missing.push('your field');
}
```

### Change Validation Rules
**File:** `server/agent/conversationHandler.ts`
**Function:** `validateInformation()` (Line ~220)

Modify validation logic:
```typescript
if (extractedData.topic && extractedData.topic.trim().length < 3) {
    issues.push('Topic is too short');
}
```

### Change Auto-Selection Confirmation
**File:** `server/agent/nodes/research.ts` or `planning.ts`

Modify the halt reason after auto-selection:
```typescript
halt: { reason: 'await_auto_selection_confirmation' }
```

### Change Step Sequence
**File:** `server/agent/graph.ts`
**Function:** `route()` (Line ~11)

Modify the switch statement to change step order:
```typescript
case 'your_step':
    return 'next_step';
```

### Change Intent Classification
**File:** `server/agent/intentClassifier.ts`
**Section:** Prompt (Line ~66)

Modify the classification rules in the prompt string.

---

## 📝 Quick Reference

| What to Change | File | Function/Line |
|---------------|------|---------------|
| Initial greeting | `conversationHandler.ts` | `handleGreeting()` ~183 |
| User responses | `conversationHandler.ts` | `handlePartialInfo()` ~372 |
| Off-topic handling | `conversationHandler.ts` | `handleOffTopic()` ~297 |
| Modification confirmations | `conversationHandler.ts` | `handleRefinement()` ~582 |
| Approval handling | `conversationHandler.ts` | `handleApproval()` ~810 |
| Missing info detection | `conversationHandler.ts` | `getMissingInformation()` ~195 |
| Validation rules | `conversationHandler.ts` | `validateInformation()` ~220 |
| Intent classification | `intentClassifier.ts` | Prompt ~66 |
| Step routing | `graph.ts` | `route()` ~11 |
| Keyword research | `nodes/research.ts` | `researchPrimaryNode()` / `researchSecondaryNode()` |
| Title generation | `nodes/planning.ts` | `titleGenerationNode()` |
| Auto-selection | `nodes/research.ts`, `nodes/planning.ts` | Auto-select sections |
| Message display | `useAgentExecutionV3.ts` | `onComplete` ~180 |
| State structure | `state.ts` | `AgentStateAnnotation` ~19 |

---

## 🔧 Tips

1. **Start with `conversationHandler.ts`** - Most behavior changes happen here
2. **Check console logs** - Each function logs what it's doing
3. **Test incrementally** - Change one thing at a time
4. **Follow the flow** - Messages go: Intent → Handler → Graph → Nodes
5. **State is key** - Understand `AgentState` structure before major changes

---

## 🚨 Important Notes

- **Confirmation patterns** are in `conversationHandler.ts` (Line ~35-37)
- **Halt reasons** are defined in `state.ts` (Line ~97)
- **Message enhancement** happens in both `server/index.ts` and `useAgentExecutionV3.ts`
- **Auto-selection** requires confirmation - see `nodes/research.ts` and `nodes/planning.ts`

