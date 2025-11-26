import React from 'react';
import { AgentState } from '../../../services/langgraph/agentGraph';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { KeywordCandidate, ChatMessage } from '../../../types';

interface SecondaryKeywordSelectionProps {
	candidates: KeywordCandidate[];
	agent: AgentState | null;
	selectedSecondaries: string[];
	setSelectedSecondaries: React.Dispatch<React.SetStateAction<string[]>>;
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

const SecondaryKeywordSelection: React.FC<SecondaryKeywordSelectionProps> = ({
	candidates,
	agent,
	selectedSecondaries,
	setSelectedSecondaries,
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
	const handleConfirm = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('secondaryKeywords'));
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: `Selected ${selectedSecondaries.length} secondary keywords: ${selectedSecondaries.join(', ')}`,
			},
			{
				role: 'assistant',
				content: `✅ Added ${selectedSecondaries.length} secondary keywords. Continuing...`,
			},
		]);

		const next = {
			...agent,
			data: {
				...agent.data,
				secondaryKeywords: selectedSecondaries,
			},
		} as AgentState;
		setAgent(next);
		updateData({ secondaryKeywords: selectedSecondaries });
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
				title: working.data.title,
			});

			// Display title selection UI if needed
			if (
				working.halt?.reason === 'await_title_selection' &&
				working.titleOptions &&
				working.titleOptions.length > 0
			) {
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: '📝 Select a title for your blog post:',
						titleSelection: {
							titles: working.titleOptions,
						},
					},
				]);
			}
		} finally {
			setIsThinking(false);
		}
	};

	return (
		<>
			<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
				{candidates.map((kw, idx) => {
					const checked = selectedSecondaries.includes(kw.text);
					return (
						<label
							key={idx}
							className='flex items-center justify-between text-sm bg-white border rounded p-2 cursor-pointer hover:bg-gray-50'
						>
							<div className='flex items-center gap-2'>
								<input
									type='checkbox'
									disabled={completedSelections.has('secondaryKeywords')}
									checked={checked}
									onChange={(e) => {
										setSelectedSecondaries((prev) => {
											if (e.target.checked) {
												const next = [...prev, kw.text];
												return next.slice(0, 5);
											}
											return prev.filter((x) => x !== kw.text);
										});
									}}
									className='w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded'
								/>
								<div>
									<div className='font-medium text-gray-800'>{kw.text}</div>
									<div className='text-xs text-gray-500'>
										Vol: {kw.volume} · Diff: {kw.difficulty.toFixed(2)}
									</div>
								</div>
							</div>
						</label>
					);
				})}
			</div>
			<div className='mt-3 text-right'>
				<button
					disabled={
						completedSelections.has('secondaryKeywords') ||
						selectedSecondaries.length === 0
					}
					className='px-4 py-2 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors disabled:bg-orange-300 disabled:cursor-not-allowed'
					onClick={handleConfirm}
				>
					Confirm Selection ({selectedSecondaries.length}/5)
				</button>
			</div>
		</>
	);
};

export default SecondaryKeywordSelection;

