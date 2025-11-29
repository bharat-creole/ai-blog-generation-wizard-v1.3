import {
	KeywordCandidate,
	Interlink,
	ReferenceFile,
	OutlineSection,
} from '../../../types';
import { AgentState } from '../../../server/agent/state';

// Props for keyword selection components
export interface KeywordSelectionProps {
	candidates: KeywordCandidate[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onSelect: (keyword: string) => void;
}

// Props for title selection component
export interface TitleSelectionProps {
	titles: string[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onSelect: (title: string) => void;
}

// Props for interlinking form
export interface InterlinkingFormProps {
	currentLinks: Interlink[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onSubmit: (links: Interlink[]) => void;
}

// Props for references form
export interface ReferencesFormProps {
	currentUrls: string[];
	currentFiles: ReferenceFile[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onSubmit: (urls: string[], files: ReferenceFile[]) => void;
}

// Props for outline approval
export interface OutlineApprovalProps {
	outline: OutlineSection[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onApprove: () => void;
	onRequestChanges: (feedback: string) => void;
}
