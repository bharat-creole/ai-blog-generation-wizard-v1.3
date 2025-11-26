import React from 'react';
import { AgentState } from '../../../services/langgraph/agentGraph';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
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
}) => {
	const handleSelect = async (title: string) => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('title'));
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: `Select "${title}" as title`,
			},
			{
				role: 'assistant',
				content: `✅ Selected title. Continuing...`,
			},
		]);

		const next = {
			...agent,
			data: {
				...agent.data,
				title,
			},
			titleSelected: true,
		} as AgentState;
		setAgent(next);
		updateData({ title });
		setIsThinking(true);

		try {
			let working = next;
			let guard = 0;
			while (guard++ < 20) {
				const { state: ns, halted } = await lgRunNext(working);
				working = ns;

				// Break if halted and needs user input
				if (halted && automationEngine.needsUserInput(ns)) {
					break;
				}
			}

			setAgent(working);
			setOutline(working.outline);
			setDraft(working.draft);
			setTraceItems(working.trace.map((t) => ({ step: t.step, at: t.at })));
			updateData({
				outline: working.outline,
				blogContent: working.draft,
			});

			// Display interlinking UI if needed
			if (working.halt?.reason === 'await_interlinking') {
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: '🔗 Add internal/external links (optional) or click "Continue" to skip:',
						interlinkingForm: {
							currentLinks: working.data.interlinks || [],
						},
					},
				]);
			}
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
						className={`px-3 py-1 text-xs text-white rounded transition-colors ml-3 ${
							completedSelections.has('title')
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

