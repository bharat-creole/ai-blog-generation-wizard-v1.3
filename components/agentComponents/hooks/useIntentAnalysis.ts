import { ChatMessage } from '../../../types';
import {
	analyzeUserIntent,
	extractTopicFromText,
	findTopicInHistory,
	validateTopic,
	UserIntent,
} from '../utils/topicExtraction';

/**
 * Intent analysis hook return type
 */
export interface UseIntentAnalysisReturn {
	analyzeUserIntent: (content: string) => UserIntent;
	extractTopicFromText: (text: string) => string | null;
	findTopicInHistory: (messages: ChatMessage[], intent: UserIntent) => string | null;
	validateTopic: (text: string, intent: UserIntent) => boolean;
}

/**
 * Custom hook for user intent analysis and topic extraction
 * @returns Object with intent analysis functions
 */
export const useIntentAnalysis = (): UseIntentAnalysisReturn => {
	return {
		analyzeUserIntent,
		extractTopicFromText,
		findTopicInHistory,
		validateTopic,
	};
};

