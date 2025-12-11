import React from 'react';
import { AgentState } from '../../../../server/agent/state';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { getStepMessage } from '../utils/agentHelpers';
import { KeywordCandidate, ChatMessage } from '../../../types';

interface PrimaryKeywordSelectionProps {
	candidates: KeywordCandidate[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	onSelectKeyword: (
		keyword: string,
		agent: AgentState,
		setCompletedSelections: React.Dispatch<
			React.SetStateAction<Set<string>>
		>,
		setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
		setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>,
		updateData: (data: any) => void,
		setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
		setOutline: React.Dispatch<React.SetStateAction<any[]>>,
		setDraft: React.Dispatch<React.SetStateAction<string>>,
		setTraceItems: React.Dispatch<React.SetStateAction<any[]>>
	) => Promise<void>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
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
}) => {
	// Sort candidates by volume (descending - highest volume first)
	const sortedCandidates = React.useMemo(() => {
		return [...candidates].sort(
			(a, b) => (b.volume || 0) - (a.volume || 0)
		);
	}, [candidates]);

	const handleSelect = async (kw: KeywordCandidate) => {
		if (!agent) return;

		setCompletedSelections((prev) =>
			new Set(prev).add('primaryKeyword')
		);
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: `Select "${kw.text}" as primary keyword`,
			},
			{
				role: 'assistant',
				content: `✅ Selected "${kw.text}" as primary keyword. Continuing...`,
			},
		]);

		const next = {
			...agent,
			data: {
				...agent.data,
				primaryKeyword: kw.text,
			},
		} as AgentState;
		setAgent(next);
		updateData({ primaryKeyword: kw.text });
		setIsThinking(true);

		try {
			let working = next;
			let guard = 0;
			let lastTraceLength = 0;

			while (guard++ < 20) {
				const { state: ns, halted } = await lgRunNext(working);
				working = ns;

				if (working.trace.length > lastTraceLength) {
					const latestTrace =
						working.trace[working.trace.length - 1];
					const stepMessage = getStepMessage(
						latestTrace.step,
						latestTrace.info
					);

					if (stepMessage) {
						// Turn off thinking indicator as soon as we start showing progress
						// This allows progress messages to be visible in real-time
						setIsThinking(false);

						setMessages((prev) => [
							...prev,
							{
								role: 'assistant',
								content: stepMessage,
							},
						]);
						await new Promise((resolve) =>
							setTimeout(resolve, 300)
						);
					}
					lastTraceLength = working.trace.length;
				}

				// Break if halted and needs user input
				if (halted && automationEngine.needsUserInput(ns)) {
					break;
				}
			}

			setAgent(working);
			setOutline(working.outline);
			setDraft(working.draft);
			setTraceItems(
				working.trace.map((t) => ({ step: t.step, at: t.at }))
			);
			updateData({
				outline: working.outline,
				blogContent: working.draft,
				secondaryKeywords: working.data.secondaryKeywords,
			});

			if (working.halt?.reason === 'await_secondary_selection') {
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: "🎯 **Which secondary keywords should we target?**\n\nSelect up to 5 related keywords that complement your primary keyword. These help cover related search terms and improve your content's reach.\n\n💡 *Tip: You can also type your own secondary keywords in the chat (comma-separated).*",
						keywordSelection: {
							type: 'secondary',
							candidates:
								working.keywordResearch?.secondaryCandidates?.slice(
									0,
									12
								) || [],
						},
					},
				]);
			}
		} finally {
			setIsThinking(false);
		}
	};

	return (
		<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
			{sortedCandidates.map((kw, idx) => (
				<div
					key={idx}
					className='flex items-center justify-between text-sm bg-white border border-gray-200 rounded-md p-2 hover:border-orange-400 transition-colors'
				>
					<div>
						<div className='font-medium text-gray-800'>
							{kw.text}
						</div>
						<div className='text-xs text-gray-500'>
							Vol: {kw.volume}
						</div>
					</div>
					<button
						disabled={completedSelections.has(
							'primaryKeyword'
						)}
						className={`px-3 py-1 text-xs text-white rounded transition-colors ${
							completedSelections.has(
								'primaryKeyword'
							)
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
