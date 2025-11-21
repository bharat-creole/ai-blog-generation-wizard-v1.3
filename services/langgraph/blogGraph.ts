import { BlogData, OutlineSection, ReferenceFile } from '../../types';
import { extractFromFiles } from '../headingExtraction';
import {
	selectReferences,
	toVirtualFiles,
	SelectedReference,
} from '../retrieval';
import * as geminiService from '../geminiService';

export interface WizardState {
	data: BlogData;
	feedback?: string;
	extractedHeadings?: string[];
	selectedReferences?: SelectedReference[];
	outline?: OutlineSection[];
	error?: string;
}

const mergeFiles = (
	original: ReferenceFile[],
	virtuals: ReferenceFile[]
): ReferenceFile[] => {
	// Avoid duplicating by name+mime
	const key = (f: ReferenceFile) =>
		`${f.name}|${f.mimeType}|${f.base64.length}`;
	const seen = new Set(original.map(key));
	const merged = [...original];
	for (const v of virtuals) {
		const k = key(v);
		if (!seen.has(k)) merged.push(v);
	}
	return merged;
};

async function stepExtractHeadings(state: WizardState): Promise<WizardState> {
	const { data } = state;
	if (!data.referenceFiles || data.referenceFiles.length === 0)
		return state;
	const { byFile, merged } = await extractFromFiles(data.referenceFiles);
	try {
		if ((import.meta as any)?.env?.DEV) {
			console.log('Extracted headings (merged):', merged);
			console.log('Extracted headings by file:', byFile);
		}
	} catch {}
	return {
		...state,
		data: {
			...data,
			extractedHeadings: merged,
			extractedHeadingsByFile: byFile,
		},
		extractedHeadings: merged,
	};
}

async function stepRouteReferences(state: WizardState): Promise<WizardState> {
	const { data } = state;
	if (!data.referenceFiles || data.referenceFiles.length === 0)
		return state;
	const selected = await selectReferences(data, data.apiKey);
	return { ...state, selectedReferences: selected };
}

async function stepPlanOutline(state: WizardState): Promise<WizardState> {
	const { data, feedback, selectedReferences } = state;
	// Build working data by appending selected references (as virtual files) if any
	const virtuals = selectedReferences
		? toVirtualFiles(selectedReferences)
		: [];
	const workingData: BlogData = {
		...data,
		referenceFiles: mergeFiles(data.referenceFiles || [], virtuals),
	};
	const outline = await geminiService.generateOutline(
		workingData,
		workingData.apiKey,
		feedback
	);
	return { ...state, outline };
}

export async function invokeOutline(
	data: BlogData,
	feedback?: string
): Promise<{ outline: OutlineSection[]; data: BlogData }> {
	// Try primary: LangGraph web entrypoint
	try {
		const lg: any = await import('@langchain/langgraph/web');
		const { Annotation, StateGraph, START, END } = lg;

		const GraphState = Annotation.Root({
			data: Annotation<any>(),
			feedback: Annotation<string | undefined>(),
			extractedHeadings: Annotation<string[] | undefined>(),
			selectedReferences: Annotation<any[] | undefined>(),
			outline: Annotation<any[] | undefined>(),
			error: Annotation<string | undefined>(),
		});

		const extractNode = async (s: any) => {
			const ns = await stepExtractHeadings({
				data: s.data,
				feedback: s.feedback,
				extractedHeadings: s.extractedHeadings,
				selectedReferences: s.selectedReferences,
				outline: s.outline,
			});
			return {
				data: ns.data,
				extractedHeadings: ns.extractedHeadings,
			} as any;
		};
		const routeNode = async (s: any) => {
			const ns = await stepRouteReferences({
				data: s.data,
				feedback: s.feedback,
				extractedHeadings: s.extractedHeadings,
				selectedReferences: s.selectedReferences,
				outline: s.outline,
			});
			return { selectedReferences: ns.selectedReferences } as any;
		};
		const planNode = async (s: any) => {
			const ns = await stepPlanOutline({
				data: s.data,
				feedback: s.feedback,
				extractedHeadings: s.extractedHeadings,
				selectedReferences: s.selectedReferences,
				outline: s.outline,
			});
			return { data: ns.data, outline: ns.outline } as any;
		};

		const workflow = new StateGraph(GraphState)
			.addNode('extract_headings', extractNode)
			.addNode('route_references', routeNode)
			.addNode('plan_outline', planNode)
			.addEdge(START, 'extract_headings')
			.addEdge('extract_headings', 'route_references')
			.addEdge('route_references', 'plan_outline')
			.addEdge('plan_outline', END);

		const app = workflow.compile({});
		const result = await app.invoke({
			data,
			feedback,
			extractedHeadings: undefined,
			selectedReferences: undefined,
			outline: undefined,
			error: undefined,
		});
		const outline = (result as any).outline || [];
		const updatedData: BlogData = { ...(result as any).data, outline };
		return { outline, data: updatedData };
	} catch {
		// Fallback: custom orchestrator
		let state: WizardState = { data, feedback };
		state = await stepExtractHeadings(state);
		state = await stepRouteReferences(state);
		state = await stepPlanOutline(state);
		const outline = state.outline || [];
		const updatedData: BlogData = { ...state.data, outline };
		return { outline, data: updatedData };
	}
}

export async function invokeBlog(
	data: BlogData
): Promise<{ content: string; data: BlogData }> {
	// Try primary: LangGraph web entrypoint (single node)
	try {
		const lg: any = await import('@langchain/langgraph/web');
		const { Annotation, StateGraph, START, END } = lg;
		const GraphState = Annotation.Root({ data: Annotation<any>() });
		const writeNode = async (s: any) => {
			const content = await geminiService.generateBlogPost(
				s.data,
				s.data.outline || [],
				s.data.apiKey
			);
			return { data: { ...s.data, blogContent: content } } as any;
		};
		const workflow = new StateGraph(GraphState)
			.addNode('write_blog', writeNode)
			.addEdge(START, 'write_blog')
			.addEdge('write_blog', END);
		const app = workflow.compile({});
		const result = await app.invoke({ data });
		const updatedData: BlogData = (result as any).data;
		return { content: updatedData.blogContent, data: updatedData };
	} catch {
		// Fallback: custom orchestrator
		const content = await geminiService.generateBlogPost(
			data,
			data.outline || [],
			data.apiKey
		);
		const updatedData: BlogData = { ...data, blogContent: content };
		return { content, data: updatedData };
	}
}
