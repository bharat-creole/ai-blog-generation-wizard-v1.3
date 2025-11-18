export enum AppStep {
    Title,
    ReferenceArticles,
    Interlinking,
    WritingStyle,
    ReviewOutline,
    YourBlogIsReady,
}

export enum AppView {
    Wizard,
    Ranker,
    Agent,
}


export interface ReferenceFile {
    name: string;
    mimeType: string;
    base64: string;
}

export interface Interlink {
    id: string;
    keyword: string;
    url: string;
}

export interface OutlineItem {
    id: string;
    name: string;
}

export interface OutlineSection {
    id: string;
    name: string;
    items: OutlineItem[];
}

export interface BlogData {
    apiKey: string;
    title: string;
    topic: string;
    targetLocation: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    suggestedTitles: string[];
    referenceUrls: string[];
    referenceFiles: ReferenceFile[];
    interlinks: Interlink[];
    brandVoice: string;
    blogGuideline: string;
    llmModel: string;
    language: string;
    outline: OutlineSection[];
    blogContent: string;
    extractedHeadings?: string[];
    extractedHeadingsByFile?: { name: string; headings: string[] }[];
}

// SEO Ranker Types
export interface SeoSubFactor {
    name: string;
    score: number;
    justification: string;
}

export interface PillarReport {
    pillar: string;
    score: number;
    justification: string;
    recommendedAction: string;
    subFactors: SeoSubFactor[];
}

export interface SeoReport {
    finalSeoScore: number;
    primaryRankingFactor: string;
    mostCriticalFlaw: string;
    detailedReport: PillarReport[];
}
