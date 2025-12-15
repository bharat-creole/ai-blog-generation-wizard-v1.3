import React, { useEffect, useRef, useMemo, useState } from 'react';
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
	sendUserMessage: (
		message: string,
		agentState: AgentState
	) => Promise<{
		response: string;
		updatedState: AgentState;
		metadata?: any;
	}>;
	// Optional: message that contains this component (for storing selection per message)
	message?: ChatMessage;
	messageIndex?: number; // Index of the message in messages array
	messages?: ChatMessage[]; // Full messages array for updating specific message
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
	message,
	messageIndex,
	messages,
}) => {
	// Sort candidates by volume (descending - highest volume first)
	const sortedCandidates = useMemo(() => {
		return [...candidates].sort(
			(a, b) => (b.volume || 0) - (a.volume || 0)
		);
	}, [candidates]);

	// ✨ LOCAL STATE: Track selections per component instance (array for checkboxes)
	// Initialize from message metadata if it exists (for historical messages)
	const [localSelectedSecondaries, setLocalSelectedSecondaries] = useState<string[]>(() => {
		// Check if this message already has stored selections
		if (message && (message as any).selectedSecondaryKeywords) {
			return (message as any).selectedSecondaryKeywords;
		}
		// For new/active component, use global state if selections match these candidates
		if (selectedSecondaries.length > 0) {
			const matchingSelections = selectedSecondaries.filter(sel => 
				candidates.some(c => c.text === sel)
			);
			return matchingSelections;
		}
		return [];
	});

	// Create a stable key from candidates to detect actual changes
	const candidatesKey = useMemo(() => {
		return candidates
			.map((c) => c.text)
			.sort()
			.join('|');
	}, [candidates]);

	// Track previous candidates to detect when they change
	const prevCandidatesRef = useRef<string>('');
	
	// Track if submit button is being processed
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Check if this specific instance is completed (stored in message metadata)
	const isThisInstanceCompleted = useMemo(() => {
		if (message && (message as any).secondaryKeywordsCompleted) {
			return true;
		}
		// Fallback to global completedSelections for backward compatibility
		return completedSelections.has('secondaryKeywords');
	}, [message, completedSelections]);

	// Reset local selections only for new instances (when candidates change and not completed)
	useEffect(() => {
		const shouldReset =
			candidatesKey !== prevCandidatesRef.current &&
			candidates.length > 0 &&
			!isThisInstanceCompleted &&
			!(message && (message as any).selectedSecondaryKeywords);

		if (shouldReset) {
			setLocalSelectedSecondaries([]);
		}

		// Always update ref to track current candidates
		prevCandidatesRef.current = candidatesKey;
	}, [
		candidatesKey,
		candidates.length,
		isThisInstanceCompleted,
		message,
	]);

	const handleConfirm = async () => {
		if (!agent || localSelectedSecondaries.length === 0) return;

		setIsSubmitting(true);
		
		// Mark this specific instance as completed
		if (messageIndex !== undefined && messages) {
			setMessages((prev) => {
				const updated = [...prev];
				if (updated[messageIndex]) {
					updated[messageIndex] = {
						...updated[messageIndex],
						selectedSecondaryKeywords: [...localSelectedSecondaries],
						secondaryKeywordsCompleted: true,
					} as ChatMessage;
				}
				return updated;
			});
		}

		// Also update global state for backward compatibility
		setSelectedSecondaries([...localSelectedSecondaries]);
		setCompletedSelections((prev) =>
			new Set(prev).add('secondaryKeywords')
		);

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Secondary keywords: ${localSelectedSecondaries.join(
				', '
			)}`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Secondary keywords: ${localSelectedSecondaries.join(', ')}`,
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
				secondaryKeywords:
					result.updatedState.data.secondaryKeywords,
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
					...result.metadata,
				},
			]);
		} catch (error) {
			console.error('Error selecting secondary keywords:', error);
			// Revert selection on error
			if (messageIndex !== undefined && messages) {
				setMessages((prev) => {
					const updated = [...prev];
					if (updated[messageIndex]) {
						updated[messageIndex] = {
							...updated[messageIndex],
							secondaryKeywordsCompleted: false,
						} as ChatMessage;
					}
					return updated;
				});
			}
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
		<div>
			<div className='font-inter text-[16px] font-normal text-[#777777] mb-[12px]'>Tip: You can also type your own secondary keywords in the chat if you prefer.</div>
			<div className='p-[16px] bg-[#FFFFFF] border border-offwhite rounded-[10px]'>
			<div className=' grid grid-cols-1 md:grid-cols-2 gap-x-[8px] gap-y-[4px]'>
				{candidates.map((kw, idx) => {
					// ✨ Use local state for checked state - each component instance has its own selections
					const checked = localSelectedSecondaries.includes(kw.text);
					const isDisabled = isThisInstanceCompleted || isSubmitting;
					
					// Create unique name per message instance to avoid checkbox conflicts
					const checkboxName = messageIndex !== undefined 
						? `secondaryKeyword-${messageIndex}-${idx}` 
						: `secondaryKeyword-${Date.now()}-${idx}`;
					
					return (
						<label
							key={idx}
							className={`flex items-center  text-sm bg-white border border-offwhite rounded-[8px] transition-colors ${
								isDisabled
									? 'cursor-not-allowed opacity-60'
									: 'cursor-pointer hover:border-primary hover:bg-[#FFF8F1]'
							} ${
								checked
									? 'border-primary bg-[#FFF4E8]'
									: 'border-offwhite'
							}`}
						>
							<div className='flex items-center'>
								<div className='px-[13px] py-[17px]'>

								
								<span className='relative'>
									<input
										type='checkbox'
										name={checkboxName}
										disabled={isDisabled}
										checked={checked}
										onChange={(e) => {
											setLocalSelectedSecondaries((prev) => {
												if (e.target.checked) {
													const next = [...prev, kw.text];
													return next.slice(0, 5); // Max 5 selections
												}
												return prev.filter((x) => x !== kw.text);
											});
											// Also update global state for active/current selection
											if (!isThisInstanceCompleted) {
												setSelectedSecondaries((prev) => {
													if (e.target.checked) {
														const next = [...prev, kw.text];
														return next.slice(0, 5);
													}
													return prev.filter((x) => x !== kw.text);
												});
											}
										}}
										className={`w-4 h-4 text-primary focus:ring-primary border-primary rounded bg-white ${checked ? 'bg-primary' : ''}`}
										/>
								</span>
								</div>
								<div className='px-[10px] py-[9px] gap-[2px]'>
									<div className='font-inter text-[14px] font-medium text-black'>{kw.text}</div>
									<div className='font-inter text-[12px] font-normal text-[#777777]'>
										Vol: {kw.volume}
									</div>
								</div>
							</div>
						</label>
					);
				})}
			</div>
			<div className='mt-3 text-left'>
				<button
					disabled={
						isThisInstanceCompleted ||
						localSelectedSecondaries.length === 0 ||
						isSubmitting
					}
					className='px-[18px] py-[8px] font-inter text-regular text-[14px] bg-success text-white  transition-colors disabled:opacity-[60%] disabled:cursor-not-allowed rounded-[26px]'
					onClick={handleConfirm}
				>
					Confirm Selection ({localSelectedSecondaries.length}/5)
				</button>
			</div>
			</div>
		</div>
	);
};

export default SecondaryKeywordSelection;
