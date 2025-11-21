# Quick Start Guide - Enhanced Agent Flow

## 🚀 Getting Started

### **Prerequisites:**
- ✅ Gemini API key
- ✅ Node.js installed
- ✅ Application running (`npm run dev`)

---

## 📖 User Guide

### **Step-by-Step Workflow:**

#### **1. Open Agent Mode**
- Click "Agent Mode" button in header
- See welcome message from agent

#### **2. Start Conversation**
- Type your topic in chat: "I want to write about AWS database services"
- Press Enter or click "Send"

#### **3. Select Primary Keyword** (Required)
- Review 10 keyword candidates
- Check Volume and Difficulty metrics
- Click "Select" on best keyword

#### **4. Select Secondary Keywords** (Required)
- Review up to 12 candidates
- Select up to 5 keywords (checkboxes)
- Click "Confirm selection"

#### **5. Choose Title** (Required)
- **Option A:** Select from 5 AI-generated titles
- **Option B:** Enter your own custom title
- Press Enter or click "Select"

#### **6. Add Interlinks** (Optional)
- **To Add:**
  - Enter keyword/anchor text
  - Enter target URL
  - Click "Add"
  - Repeat as needed
- **To Skip:** Click "Continue (Skip if done)"

#### **7. Add References** (Optional)
- **To Add:**
  - Enter reference URL
  - Press Enter or click "Add"
  - Repeat as needed
- **To Skip:** Click "Continue (Skip if done)"

#### **8. Review Outline** (Required)
- Check outline in Live Draft panel
- Verify H2 and H3 structure
- Click "Approve outline"

#### **9. Watch Generation** (Automatic)
- Agent generates blog section by section
- Live SEO score updates after each section
- Watch draft grow in real-time

#### **10. Review Final Blog** (Done!)
- Complete blog displayed in Live Draft
- Final SEO score shown
- Copy content or save to wizard

---

## 💻 Developer Guide

### **Understanding the Flow:**

#### **Key Files:**
```
services/langgraph/agentGraph.ts  ← Agent orchestration
components/AgentMode.tsx          ← User interface
services/geminiService.ts         ← AI integration
services/keywordService.ts        ← Keyword research
```

#### **Flow Execution:**

```typescript
// 1. User sends message
handleSend() → lgRunNext(working)

// 2. Router determines step
route(state) → 'research_primary' | 'title_generation' | ...

// 3. Execute node
runNext(state) → researchPrimaryNode() | titleGenerationNode() | ...

// 4. Node updates state & halts
state.halt = { reason: 'await_title_selection' }

// 5. UI shows panel
{agent?.halt?.reason === 'await_title_selection' && <TitlePanel />}

// 6. User action triggers next iteration
onClick → lgRunNext(updatedState)
```

### **Adding a Custom Step:**

#### **Example: Add "Image Selection" Step**

**1. Update AgentState (`agentGraph.ts`):**
```typescript
export interface AgentState {
  // ... existing fields
  imageOptions?: string[];
  imageSelected?: boolean;
}
```

**2. Create Node Function:**
```typescript
export async function imageSelectionNode(s: AgentState): Promise<AgentState> {
  // Generate image options
  s.imageOptions = ['image1.jpg', 'image2.jpg', 'image3.jpg'];
  s.halt = { reason: 'await_image_selection' };
  appendTrace(s, 'ImageSelection.prompted');
  return s;
}
```

**3. Update Route:**
```typescript
export function route(s: AgentState): RouteType {
  // ... existing checks
  if (!s.imageSelected) return 'image_selection';
  // ... rest of logic
}
```

**4. Update runNext:**
```typescript
export async function runNext(s: AgentState): Promise<...> {
  const r = route(s);
  
  // ... existing cases
  
  if (r === 'image_selection') {
    const ns = await imageSelectionNode(s);
    return { state: ns, halted: true, step: 'image_selection' };
  }
  
  // ... rest of logic
}
```

**5. Add UI Panel (`AgentMode.tsx`):**
```typescript
{agent?.halt?.reason === 'await_image_selection' && (
  <div className="mb-4 p-3 border rounded bg-indigo-50">
    <div className="font-semibold mb-2">Select Blog Header Image</div>
    <div className="grid grid-cols-3 gap-2">
      {agent.imageOptions?.map((img, idx) => (
        <div key={idx} className="cursor-pointer" onClick={...}>
          <img src={img} alt={`Option ${idx + 1}`} />
        </div>
      ))}
    </div>
  </div>
)}
```

**6. Add Halt Message:**
```typescript
// In handleSend()
if (working.halt?.reason === 'await_image_selection') {
  setMessages(prev => ([...prev, { 
    role: 'assistant', 
    content: 'Please select a header image for your blog.' 
  }]));
}
```

**Done!** Your custom step is integrated.

---

## 🔍 Debugging Tips

### **Enable Trace Panel:**
- Click "Show Trace" button
- See all executed steps with timestamps
- Identify where flow stops

### **Check Browser Console:**
```javascript
// The agent logs state changes
console.log('Agent state:', agent);
console.log('Current halt:', agent?.halt?.reason);
console.log('Route result:', route(agent));
```

### **Use React DevTools:**
- Inspect `agent` state
- Check `halt` reason
- Verify state flags (titleSelected, interlinkingCompleted, etc.)

### **Common Issues:**

| Issue | Cause | Solution |
|-------|-------|----------|
| Stuck on step | Missing state flag | Set completion flag (e.g., `titleSelected: true`) |
| Wrong panel shows | Incorrect halt reason | Check `halt.reason` value |
| No progression | Route logic error | Review `route()` conditions |
| API error | Missing API key | Check `data.apiKey` exists |

---

## 📊 State Flags Reference

### **Completion Flags:**

| Flag | Type | When Set | Purpose |
|------|------|----------|---------|
| `titleSelected` | boolean | After title chosen | Skip title generation |
| `interlinkingCompleted` | boolean | After skip/continue | Skip interlinking |
| `referencesCollected` | boolean | After skip/continue | Skip references |
| `outlineApproved` | boolean | After approval | Start content generation |
| `finalBlogGenerated` | boolean | After final blog | Flow complete |

### **Data Flags:**

| Flag | Type | Purpose |
|------|------|---------|
| `titleOptions` | string[] | Store generated titles |
| `keywordResearch.primaryCandidates` | KwRow[] | Store primary keywords |
| `keywordResearch.secondaryCandidates` | KwRow[] | Store secondary keywords |

---

## 🎨 UI Panel Reference

### **Panel Structure:**

```tsx
{agent?.halt?.reason === 'YOUR_HALT_REASON' && (
  <div className="mb-4 p-3 border rounded bg-COLOR-50">
    <div className="font-semibold mb-2">Panel Title</div>
    <div className="text-sm text-gray-700 mb-3">Instructions</div>
    
    {/* Content area */}
    <div className="space-y-2 mb-3">
      {/* Your UI elements */}
    </div>
    
    {/* Action buttons */}
    <button
      className="px-3 py-1 text-sm bg-COLOR-600 text-white rounded"
      onClick={handleAction}
    >
      Action Button
    </button>
  </div>
)}
```

### **Color Scheme:**

| Step | Color | Tailwind Class |
|------|-------|----------------|
| Keywords | Amber | `bg-amber-50`, `bg-amber-600` |
| Title | Purple | `bg-purple-50`, `bg-purple-600` |
| Interlinking | Green | `bg-green-50`, `bg-green-600` |
| References | Yellow | `bg-yellow-50`, `bg-yellow-600` |
| Outline | Blue | `bg-blue-50`, `bg-blue-600` |

---

## 🧪 Testing Your Changes

### **Manual Test Flow:**

```bash
# 1. Start dev server
npm run dev

# 2. Open browser
http://localhost:5173

# 3. Navigate to Agent Mode

# 4. Test complete flow:
#    - Enter topic
#    - Select primary keyword
#    - Select 5 secondary keywords
#    - Select title (or enter custom)
#    - Add 2-3 interlinks
#    - Add 1-2 references
#    - Approve outline
#    - Watch generation
#    - Verify final blog

# 5. Test skip flow:
#    - Enter topic
#    - Select keywords
#    - Select title
#    - Skip interlinking
#    - Skip references
#    - Approve outline
#    - Watch generation

# 6. Test edge cases:
#    - Empty inputs
#    - Invalid URLs
#    - Missing API key
#    - Network errors
```

---

## 📚 API Integration

### **Gemini AI Calls:**

```typescript
// 1. Generate titles
const titles = await geminiService.generateTitles(data, apiKey);

// 2. Generate outline
const outline = await geminiService.generateOutline(data, apiKey);

// 3. Generate section
const section = await agentService.generateSectionContent(
  data, section, apiKey, { targetKeyword, interlinks, referenceUrls }
);

// 4. Generate full blog
const blog = await geminiService.generateBlogPost(data, outline, apiKey);

// 5. Rank blog
const seoReport = await geminiService.rankBlogPost(
  content, keyword, apiKey, 'gemini-flash-latest'
);
```

### **Keyword Research:**

```typescript
// Get keyword ideas
const ideas = await keywordTool.getKeywordIdeas(seed, location);

// Dedupe and merge
const merged = keywordTool.dedupeMerge(ideas);

// Score and rank
const ranked = keywordTool.scoreIdeas(merged, title);
```

---

## 🚨 Error Handling

### **Try-Catch Pattern:**

```typescript
try {
  setIsThinking(true);
  
  // Your logic
  const result = await someApiCall();
  
  // Update state
  setAgent(newState);
  
} catch (e: any) {
  setError(e?.message || 'Operation failed');
  console.error('Error:', e);
} finally {
  setIsThinking(false);
}
```

### **API Error Handling:**

```typescript
// In geminiService.ts
if (!apiKey) throw new Error('API Key is required.');

// In AgentMode.tsx
if (!apiKey) {
  setError('Please set your Gemini API Key in the Wizard first.');
  return;
}
```

---

## 🎯 Best Practices

### **State Management:**
- ✅ Always clone state before mutation
- ✅ Set completion flags after user actions
- ✅ Update all related state simultaneously
- ✅ Use TypeScript for type safety

### **UI Updates:**
- ✅ Show loading states during async operations
- ✅ Provide clear error messages
- ✅ Use semantic colors for different steps
- ✅ Make buttons disabled during loading

### **Performance:**
- ✅ Use guard clauses in node functions
- ✅ Limit API calls (use debouncing for SEO scoring)
- ✅ Conditional panel rendering
- ✅ Avoid unnecessary re-renders

---

## 📖 Learning Path

### **For Beginners:**
1. Read `ENHANCED_AGENT_FLOW.md`
2. Trace through one complete flow in code
3. Understand `route()` function
4. Study one node function
5. Examine one UI panel

### **For Advanced:**
1. Read `IMPLEMENTATION_SUMMARY.md`
2. Study state management patterns
3. Understand LangGraph integration
4. Implement custom step (practice)
5. Optimize performance

---

## 🆘 Getting Help

### **Documentation:**
- 📄 `ENHANCED_AGENT_FLOW.md` - Complete guide
- 📄 `IMPLEMENTATION_SUMMARY.md` - Technical details
- 📄 `CHANGELOG_AGENT_ENHANCEMENTS.md` - What changed
- 📄 This file - Quick reference

### **Debugging:**
1. Enable trace panel
2. Check browser console
3. Inspect state in DevTools
4. Add console.logs in node functions
5. Test with simple inputs first

---

## ✅ Checklist

### **Before Development:**
- [ ] Read documentation
- [ ] Understand existing flow
- [ ] Set up dev environment
- [ ] Test current implementation

### **During Development:**
- [ ] Follow code patterns
- [ ] Add TypeScript types
- [ ] Test each change
- [ ] Keep UI consistent
- [ ] Handle errors

### **After Development:**
- [ ] Test complete flow
- [ ] Test edge cases
- [ ] Check for lint errors
- [ ] Update documentation
- [ ] Test in multiple browsers

---

## 🎉 You're Ready!

You now have everything you need to:
- ✅ Use the enhanced agent flow
- ✅ Understand the implementation
- ✅ Add custom steps
- ✅ Debug issues
- ✅ Extend functionality

**Happy coding!** 🚀

