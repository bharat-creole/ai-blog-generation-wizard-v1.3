# Blog Generation Agent Flow

```mermaid
flowchart TD
    %% ENTRY POINT
    Start[Start] --> Keywords[Keywords & Title]
    
    %% KEYWORDS & TITLE
    subgraph KeywordsTitle["Step 1: Keywords & Title"]
        direction TB
        K1[User provides topic/title] --> KR[KeywordResearchNode]
        KR -->|halt: await_keyword_selection| KSel[User selects primary keyword]
        KSel --> KR2[Secondary research]
        KR2 -->|halt: await_secondary_selection| KSel2[User selects secondary keywords]
    end
    
    Keywords -->|Primary + Secondaries| Outline[Outline Generation]
    
    %% OUTLINE GENERATION
    subgraph OutlineGen["Step 2: Outline Generation"]
        direction TB
        O1[Generate initial outline] --> O2[halt: awaiting_approval]\nUser reviews outline
        O2 -->|Needs changes| O3[Edit outline]
        O3 --> O2
        O2 -->|Approved| O4[Proceed to writing style]
    end
    
    Outline -->|Approved Outline| WritingStyle[Writing Style]
    
    %% WRITING STYLE
    subgraph WritingStyle["Step 3: Writing Style"]
        direction TB
        W1[Set brand voice] --> W2[Set blog guidelines]
        W2 --> W3[Select language]
    end
    
    WritingStyle -->|Style Settings| Review[Review]
    
    %% REVIEW
    subgraph ReviewStep["Step 4: Review"]
        direction TB
        R1[Show all settings] --> R2[User confirms or makes changes]
        R2 -->|Changes needed| R3[Go back to relevant step]
        R2 -->|Confirmed| R4[Proceed to generation]
    end
    
    Review -->|Confirmed| Generation[Blog Generation]
    
    %% BLOG GENERATION
    subgraph BlogGen["Step 5: Blog Generation"]
        direction TB
        G1[Generate blog content] --> G2[Show progress]
        G2 --> G3[Show generated blog]
        G3 --> G4[User reviews blog]
        G4 -->|Needs changes| G5[Regenerate with feedback]
        G5 --> G1
        G4 -->|Approved| G6[Save/Publish]
    end
    
    %% EDGES BETWEEN MAIN STEPS
    KeywordsTitle -->|User input| OutlineGen
    OutlineGen -->|User input| WritingStyle
    WritingStyle -->|User input| ReviewStep
    ReviewStep -->|User input| BlogGen
    
    %% STYLING
    classDef step fill:#f5f5f5,stroke:#333,stroke-width:2px
    class KeywordsTitle,OutlineGen,WritingStyle,ReviewStep,BlogGen step
    
    classDef decision fill:#fff3cd,stroke:#ffc107,stroke-width:2px
    class R2,G4 decision
```

## Flow Description

1. **Keywords & Title**
   - User provides initial topic/title
   - KeywordResearchNode calls keyword tool for user seed + title-derived seeds
   - Node ranks/merges results and halts for primary selection (await_keyword_selection)
   - Runs secondary research and halts for secondary selection (await_secondary_selection)
   - Stores research snapshot and selections in state

2. **Outline Generation**
   - System generates initial outline
   - User can review and edit outline
   - Loop until user approves

3. **Writing Style**
   - Set brand voice (optional)
   - Set blog guidelines (optional)
   - Select language

4. **Review**
   - Show all settings and inputs
   - User confirms or goes back to make changes

5. **Blog Generation**
   - Generate blog content
   - Show generation progress
   - User reviews and can regenerate with feedback
   - Option to save or publish

## Notes
- User can provide information at any step
- System validates inputs at each step
- Progress is auto-saved
- User can go back to previous steps
- Clear feedback is provided at each stage
