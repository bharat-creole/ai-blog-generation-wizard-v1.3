import React, { useEffect, useRef, useMemo } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { KeywordCandidate, ChatMessage } from '../../../types';

interface PrimaryKeywordSelectionProps {
	candidates: KeywordCandidate[];
	agent: AgentState | null;
	selectedPrimary: string | null;
	setSelectedPrimary: React.Dispatch<React.SetStateAction<string | null>>;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
	sendUserMessage: (
		message: string,
		agentState: AgentState
	) => Promise<{
		response: string;
		updatedState: AgentState;
		metadata?: any;
	}>;
}

const PrimaryKeywordSelection: React.FC<PrimaryKeywordSelectionProps> = ({
	candidates,
	agent,
	selectedPrimary,
	setSelectedPrimary,
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
	// Sort candidates by volume (descending - highest volume first)
	const sortedCandidates = useMemo(() => {
		return [...candidates].sort(
			(a, b) => (b.volume || 0) - (a.volume || 0)
		);
	}, [candidates]);

	// Create a stable key from candidates to detect actual changes
	const candidatesKey = useMemo(() => {
		return candidates
			.map((c) => c.text)
			.sort()
			.join('|');
	}, [candidates]);

	// Track previous candidates to detect when they change
	const prevCandidatesRef = useRef<string>('');

	// Reset selection whenever component loads with new candidates
	useEffect(() => {
		const isCompleted = completedSelections.has('primaryKeyword');

		// Reset if:
		// 1. Candidates changed (different set of keywords)
		// 2. Component is shown with candidates and selection is not completed
		const shouldReset =
			candidatesKey !== prevCandidatesRef.current &&
			candidates.length > 0 &&
			!isCompleted;

		if (shouldReset) {
			setSelectedPrimary(null);
		}

		// Always update ref to track current candidates
		prevCandidatesRef.current = candidatesKey;
	}, [
		candidatesKey,
		candidates.length,
		completedSelections,
		setSelectedPrimary,
	]);

	const handleConfirm = async () => {
		if (!agent || !selectedPrimary) return;

		setCompletedSelections((prev) =>
			new Set(prev).add('primaryKeyword')
		);

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Primary keyword: ${selectedPrimary}`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Primary keyword: ${selectedPrimary}`,
				agent
			);

			// Update state from backend response
			setAgent(result.updatedState);
			setOutline(result.updatedState.outline);
			setDraft(result.updatedState.draft);

			// Update trace items if available
			if (result.updatedState.trace) {
				setTraceItems(
					result.updatedState.trace.map((t) => ({
						step: t.step,
						at: t.at,
					}))
				);
			}

			// Update parent data
			updateData({
				primaryKeyword: result.updatedState.data.primaryKeyword,
				secondaryKeywords:
					result.updatedState.data.secondaryKeywords,
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Add assistant response
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: result.response,
					...result.metadata,
				},
			]);
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
		<>
			<div className='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2'>
				{sortedCandidates.map((kw, idx) => {
					const isSelected = selectedPrimary === kw.text;
					return (
						<label
							key={idx}
							className={`flex items-center justify-between text-sm bg-white border rounded p-2 cursor-pointer transition-colors ${
								isSelected
									? 'border-orange-500 bg-orange-50'
									: 'border-gray-200 hover:border-orange-400 hover:bg-gray-50'
							}`}
						>
							<div className='flex items-center gap-2 flex-1'>
								<input
									type='radio'
									name='primaryKeyword'
									disabled={completedSelections.has(
										'primaryKeyword'
									)}
									checked={isSelected}
									onChange={() =>
										setSelectedPrimary(
											kw.text
										)
									}
									className='w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300'
								/>
								<div>
									<div className='font-medium text-gray-800'>
										{kw.text}
									</div>
									<div className='text-xs text-gray-500'>
										Vol: {kw.volume}
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
						completedSelections.has('primaryKeyword') ||
						!selectedPrimary
					}
					className='px-4 py-2 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors disabled:bg-orange-300 disabled:cursor-not-allowed'
					onClick={handleConfirm}
				>
					Confirm Selection
				</button>
			</div>
		</>
	);
};

export default PrimaryKeywordSelection;
