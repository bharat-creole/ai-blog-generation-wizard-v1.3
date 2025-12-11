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
		<div>
			<div className='flex flex-col gap-[12px] mb-[12px]'>
                <div className='font-inter text-[16px] font-semibold text-black'>What main keyword should this article rank for?</div>
                <div className='font-inter text-[16px] font-normal text-black'>Select the primary keyword that best represent your target search term. This will be the main focus keyword for SEO optimization.</div>
                <div className='font-inter text-[16px] font-normal text-[#777777]'>Tip: You can also type your own primary keyword in the chat if you prefer.</div>
            </div>
			<div className='p-[16px] rounded-[10px] border border-offwhite bg-[#FFFFFF] gap-[4px]'>
				<div className='font-inter text-[16px] font-semibold text-black mb-[8px]'>Primary Keywords in</div>
				<div className='font-inter text-[14px] font-medium text-[#777777] mb-[9px]'>Primary Keywords</div>
			<div className=' grid grid-cols-1 md:grid-cols-2 gap-x-[8px] gap-y-[4px] '>
				{candidates.map((kw, idx) => {
					const isSelected = selectedPrimary === kw.text;
					return (
						<label
						key={idx}
						className={`flex items-center  text-sm bg-white border border-offwhite rounded-[8px]   cursor-pointer transition-colors hover:border-primary hover:bg-[#FFF8F1] ${
								isSelected
									? 'border-primary bg-[#FFF4E8]'
									: 'border-offwhite'
						}`}
						>
							<div className='px-[13px] py-[17px]'>

								<input
									type='radio'
									name='primaryKeyword'
									disabled={completedSelections.has(
										'primaryKeyword'
									)}
									checked={isSelected}
									onChange={() => setSelectedPrimary(kw.text)}
									className='w-4 h-4 text-primary focus:ring-primary border-primary'
									/>
									</div>
								<div className='px-[10px] py-[9px] gap-[2px]'>
									<div className='font-inter font-medium text-black'>{kw.text}</div>
									<div className='font-inter text-[12px] font-normal text-[#777777]'>
										Vol: {kw.volume}
									</div>
								</div>
							
						</label>
					);
				})}
			</div>
				</div>
			<div className='mt-3 text-left'>
				<button
					disabled={
						completedSelections.has('primaryKeyword') ||
						!selectedPrimary
					}
					className='px-[18px] py-[8px] font-inter text-regular text-[14px] bg-success text-white  transition-colors disabled:opacity-[60%] disabled:cursor-not-allowed rounded-[26px]'
					onClick={handleConfirm}
				>
					Confirm Selection
				</button>
			</div>
		</div>
	);
};

export default PrimaryKeywordSelection;
