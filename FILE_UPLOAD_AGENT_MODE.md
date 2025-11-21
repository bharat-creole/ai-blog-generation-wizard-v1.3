# 📁 File Upload in Agent Mode - Complete Guide

## ✅ What's Been Added

Agent Mode now supports **BOTH URLs and File uploads** (PDF/DOCX) for reference materials in **Guided** and **Manual** modes!

---

## 🎯 When Does It Appear?

### **Guided Mode or Manual Mode:**
When the agent reaches the **References Collection** step, users will see:

```
┌─────────────────────────────────────────────────┐
│ 📚 Add Reference Materials (Optional)           │
├─────────────────────────────────────────────────┤
│                                                  │
│  🔗 Reference URLs        📄 Reference Files    │
│  ┌──────────────────┐     ┌──────────────────┐ │
│  │ URL input field  │     │ Upload button    │ │
│  │ Add button       │     │ File list        │ │
│  │ URL list         │     │ Remove files     │ │
│  └──────────────────┘     └──────────────────┘ │
│                                                  │
│  Added: 2 URL(s), 1 File(s)                    │
│  [✅ Continue with References]                  │
└─────────────────────────────────────────────────┘
```

### **Full Automation Mode:**
- ✅ References are used automatically if provided
- ❌ No UI prompts (user adds references before starting)

---

## 📋 Features

### **1. URL Section (Left)**
- ✅ Add reference URLs
- ✅ Display all added URLs
- ✅ Remove individual URLs
- ✅ Enter key support for quick add
- ✅ Duplicate URL prevention

### **2. File Section (Right)**
- ✅ Upload PDF or DOCX files
- ✅ Display uploaded files with icons
  - 📕 PDF files
  - 📘 DOCX files
- ✅ Remove individual files
- ✅ File name display
- ✅ Support for multiple files

### **3. Summary & Continue**
- ✅ Shows count of URLs and Files
- ✅ Smart button text:
  - "Continue with References" (if materials added)
  - "Skip & Continue" (if nothing added)

---

## 🔍 How It Works

### **Step 1: Agent Halts for References**

When agent reaches `referencesCollectionNode`:

```typescript
agent.halt = { reason: 'await_references' }
```

### **Step 2: UI Displays Collection Panel**

The new enhanced panel appears with:
- Two columns (URLs and Files)
- Upload functionality
- Real-time list updates

### **Step 3: User Adds Materials**

**Option A: Add URLs**
```
1. Type URL in input field
2. Press Enter or click "Add"
3. URL appears in list
4. Can remove with ✕ button
```

**Option B: Upload Files**
```
1. Click "📤 Upload File" button
2. Select PDF or DOCX file
3. File converts to base64
4. File appears in list with icon
5. Can remove with ✕ button
```

### **Step 4: Continue**

Click "Continue with References" button:
```
1. Sets referencesCollected = true
2. Logs references being used
3. Agent continues to outline generation
4. References passed to Gemini for processing
```

---

## 🎨 Visual Design

### **Enhanced UI Features:**

**Color Scheme:**
- Gradient background: Yellow-50 to Orange-50
- Border: Yellow-300
- Buttons: Yellow-600 to Orange-600

**Layout:**
- Responsive grid (1 column mobile, 2 columns desktop)
- White cards for each section
- Scrollable lists (max-height: 160px)
- Icons for visual clarity

**User Feedback:**
- Empty state messages
- File type icons (📕 PDF, 📘 DOCX)
- Real-time count display
- Hover effects on buttons

---

## 📊 What Gets Passed to Agent

### **Discovery Node (Outline Generation):**

```typescript
BlogData {
  referenceUrls: [
    "https://example.com/article1",
    "https://research.org/paper2"
  ],
  referenceFiles: [
    {
      name: "research-paper.pdf",
      mimeType: "application/pdf",
      base64: "JVBERi0xLjQK..."
    },
    {
      name: "whitepaper.docx",
      mimeType: "application/vnd.openxmlformats...",
      base64: "UEsDBBQABgAI..."
    }
  ]
}
```

**Gemini receives both URLs and file content** to generate outline!

### **Proposal Node (Content Generation):**

Same data structure passed for each section generation.

**Gemini uses references** to write factual, well-researched content!

---

## 🔍 Logging

### **When References Added:**

```
📚 [REFERENCES] User completed reference collection
   URLs: 2
   Files: 1
```

### **During Outline Generation:**

```
📚 [OUTLINE GENERATION] Using references:
   URLs: 2
   Files: 1
```

### **During Content Generation:**

```
📚 [CONTENT GENERATION] Using references:
   URLs: 2
   Files: 1
```

---

## 🎯 User Experience Flow

### **Scenario: User wants to write about AI in Healthcare**

**Step 1: Enter topic**
```
User: "Write a blog about AI in healthcare"
```

**Step 2: Keywords selected**
```
Agent: Generates and selects keywords
```

**Step 3: Title selected**
```
Agent: Generates title options
User: Selects title
```

**Step 4: References Collection (NEW!)**
```
Agent: Shows reference collection panel

User actions:
1. Adds 2 research paper URLs
2. Uploads 1 PDF whitepaper
3. Clicks "Continue with References"
```

**Step 5: Outline Generation**
```
Agent: Uses references to generate outline
- Analyzes research papers
- Extracts topics from PDF
- Creates comprehensive outline
```

**Step 6: Content Generation**
```
Agent: Writes content using references
- Includes facts from papers
- Cites research findings
- Maintains accuracy
```

**Result:** High-quality, well-researched blog! 🎉

---

## 🔧 Technical Details

### **File Conversion:**

```typescript
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove "data:mime/type;base64," prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
};
```

### **Accepted File Types:**

```html
<input 
  type="file" 
  accept=".pdf,.doc,.docx"
/>
```

- ✅ PDF (`.pdf`)
- ✅ DOCX (`.docx`)
- ✅ DOC (`.doc`)

### **Data Structure:**

```typescript
interface ReferenceFile {
  name: string;        // "research.pdf"
  mimeType: string;    // "application/pdf"
  base64: string;      // Base64 encoded content
}
```

---

## 🎛️ Mode-Specific Behavior

### **Full Automation:**
- ❌ Panel doesn't appear
- ✅ Uses references if already in BlogData
- ✅ Silently continues

### **Guided Mode:**
- ✅ Panel appears
- ✅ User can add/skip references
- ✅ Optional step

### **Manual Mode:**
- ✅ Panel appears
- ✅ User has full control
- ✅ Optional step

---

## ✨ Key Improvements

### **Before:**
- ❌ Only URLs supported in Agent Mode
- ❌ Files only in Wizard Mode
- ❌ Inconsistent UX

### **After:**
- ✅ Both URLs and Files in Agent Mode
- ✅ Consistent with Wizard Mode
- ✅ Enhanced UI with better visuals
- ✅ Real-time feedback
- ✅ Proper logging
- ✅ Better user guidance

---

## 🚀 How to Use

### **Step 1: Start Agent Mode**
```bash
npm run dev:full
```

### **Step 2: Select Guided or Manual Mode**
```
⚙️ Control Level: [Guided] or [Manual]
```

### **Step 3: Enter Topic**
```
User: "Write about quantum computing"
```

### **Step 4: Follow Agent Prompts**
- Select keywords
- Select title
- **NEW:** Add references (URLs + Files)
- Approve outline
- Wait for content generation

### **Step 5: Get Research-Based Blog!**
✅ Content based on your reference materials
✅ Facts from PDFs and URLs
✅ Well-researched and accurate

---

## 📝 Example Workflow

```
🤖 Agent: "Write a blog about blockchain technology"

1. Keywords Research → Selected
2. Title Generation → Selected
3. 📚 References Collection (NEW!)
   
   User adds:
   - https://ethereum.org/whitepaper.pdf
   - https://bitcoin.org/bitcoin.pdf
   - blockchain-guide.pdf (uploaded)
   
   Clicks: "Continue with References"

4. Agent generates outline based on:
   ✅ Ethereum whitepaper content
   ✅ Bitcoin whitepaper content
   ✅ blockchain-guide.pdf content

5. Agent writes sections with facts from references

6. Final blog includes research-backed content! 🎉
```

---

## 🎯 Benefits

✅ **Better Research:** Use PDFs and URLs together  
✅ **Higher Quality:** Content backed by references  
✅ **Flexibility:** Choose what to provide  
✅ **Consistent UX:** Same as Wizard Mode  
✅ **Visual Feedback:** See what you've added  
✅ **Easy Management:** Add/remove materials easily  
✅ **Logged Actions:** Track reference usage  
✅ **Professional Output:** Well-researched blogs  

---

## 🎉 Ready to Use!

Just run the app and use Agent Mode with Guided or Manual mode. When the agent asks for references, you'll see the new enhanced panel with both URL and file upload options!

**Your blogs will be more accurate, well-researched, and professional!** 📚🚀

