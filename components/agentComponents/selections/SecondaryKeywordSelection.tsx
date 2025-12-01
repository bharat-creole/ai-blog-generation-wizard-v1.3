import React, { useEffect, useRef, useMemo } from 'react';
import { AgentState } from '../../../../server/agent/state';
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
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
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
	sendUserMessage,
}) => {
	// Create a stable key from candidates to detect actual changes
	const candidatesKey = useMemo(() => {
		return candidates.map(c => c.text).sort().join('|');
	}, [candidates]);

	// Track previous candidates to detect when they change
	const prevCandidatesRef = useRef<string>('');

	// Reset selections whenever component loads with new candidates
	// This ensures a fresh start every time the component is shown
	useEffect(() => {
		const isCompleted = completedSelections.has('secondaryKeywords');
		
		// Reset if:
		// 1. Candidates changed (different set of keywords)
		// 2. Component is shown with candidates and selection is not completed
		const shouldReset = 
			candidatesKey !== prevCandidatesRef.current &&
			candidates.length > 0 &&
			!isCompleted;
		
		if (shouldReset) {
			setSelectedSecondaries([]);
		}
		
		// Always update ref to track current candidates
		prevCandidatesRef.current = candidatesKey;
	}, [candidatesKey, candidates.length, completedSelections, setSelectedSecondaries]);

	const handleConfirm = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('secondaryKeywords'));

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Secondary keywords: ${selectedSecondaries.join(', ')}`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Secondary keywords: ${selectedSecondaries.join(', ')}`,
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
				secondaryKeywords: result.updatedState.data.secondaryKeywords,
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
				title: result.updatedState.data.title,
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
			console.error('Error selecting secondary keywords:', error);
			// Revert selection on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('secondaryKeywords');
				return newSet;
			});
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

