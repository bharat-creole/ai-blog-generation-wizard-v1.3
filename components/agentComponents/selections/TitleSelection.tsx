import React from 'react';
import { AgentState } from '../../../../server/agent/state';
import { ChatMessage } from '../../../types';

interface TitleSelectionProps {
	titles: string[];
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

const TitleSelection: React.FC<TitleSelectionProps> = ({
	titles,
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
	const handleSelect = async (title: string) => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('title'));

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Select "${title}" as title`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Select "${title}" as title`,
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
				title: result.updatedState.data.title,
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Add assistant response
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: result.response,
					...result.metadata
				},
			]);

		} catch (error) {
			console.error('Error selecting title:', error);
			// Revert selection on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('title');
				return newSet;
			});
		} finally {
			setIsThinking(false);
		}
	};

	if (!titles || titles.length === 0) return null;

	return (
		<div className='mt-3 space-y-2'>
			{titles.map((title, idx) => (
				<div
					key={idx}
					className='flex items-center justify-between text-sm bg-white border rounded p-3 hover:bg-gray-50 transition-colors'
				>
					<div className='flex-1 font-medium text-gray-800'>{title}</div>
					<button
						disabled={completedSelections.has('title')}
						className={`px-3 py-1 text-xs text-white rounded transition-colors ml-3 ${completedSelections.has('title')
								? 'bg-gray-400 cursor-not-allowed'
								: 'bg-purple-500 hover:bg-purple-600'
							}`}
						onClick={() => handleSelect(title)}
					>
						Select
					</button>
				</div>
			))}
		</div>
	);
};

export default TitleSelection;

