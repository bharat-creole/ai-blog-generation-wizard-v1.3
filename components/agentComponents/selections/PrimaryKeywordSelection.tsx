import React from 'react';
import { AgentState } from '../../../../server/agent/state';
import { KeywordCandidate, ChatMessage } from '../../../types';

interface PrimaryKeywordSelectionProps {
	candidates: KeywordCandidate[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
}

const PrimaryKeywordSelection: React.FC<PrimaryKeywordSelectionProps> = ({
	candidates,
	agent,
	completedSelections,
	setCompletedSelections,
	setMessages,
	setAgent,
	updateData,
	setIsThinking,
	setOutline,
	setDraft,
	setTraceItems,
	sendUserMessage,
}) => {
	const handleSelect = async (kw: KeywordCandidate) => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('primaryKeyword'));

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Primary keyword: ${kw.text}`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Primary keyword: ${kw.text}`,
				agent
			);

			// Update state from backend response
			setAgent(result.updatedState);
			setOutline(result.updatedState.outline);
			setDraft(result.updatedState.draft);

			// Update trace items if available
			if (result.updatedState.trace) {
				setTraceItems(result.updatedState.trace.map((t) => ({ step: t.step, at: t.at })));
			}

			// Update parent data
			updateData({
				primaryKeyword: result.updatedState.data.primaryKeyword,
				secondaryKeywords: result.updatedState.data.secondaryKeywords,
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Note: Assistant message is already added by useAgentExecutionV3 hook

		} catch (error) {
			console.error('Error selecting primary keyword:', error);
			// Revert selection on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('primaryKeyword');
				return newSet;
			});
		} finally {
			setIsThinking(false);
		}
	};

	return (
		<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
			{candidates.map((kw, idx) => (
				<div
					key={idx}
					className='flex items-center justify-between text-sm bg-white border border-gray-200 rounded-md p-2 hover:border-orange-400 transition-colors'
				>
					<div>
						<div className='font-medium text-gray-800'>{kw.text}</div>
						<div className='text-xs text-gray-500'>
							Vol: {kw.volume} · Diff: {kw.difficulty.toFixed(2)}
						</div>
					</div>
					<button
						disabled={completedSelections.has('primaryKeyword')}
						className={`px-3 py-1 text-xs text-white rounded transition-colors ${completedSelections.has('primaryKeyword')
								? 'bg-gray-400 cursor-not-allowed'
								: 'bg-orange-500 hover:bg-orange-600'
							}`}
						onClick={() => handleSelect(kw)}
					>
						Select
					</button>
				</div>
			))}
		</div>
	);
};

export default PrimaryKeywordSelection;

