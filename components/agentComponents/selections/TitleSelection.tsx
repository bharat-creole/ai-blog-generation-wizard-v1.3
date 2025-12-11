import React, { useEffect, useRef, useMemo } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { ChatMessage } from '../../../types';

interface TitleSelectionProps {
	titles: string[];
	agent: AgentState | null;
	selectedTitle: string | null;
	setSelectedTitle: React.Dispatch<React.SetStateAction<string | null>>;
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

const TitleSelection: React.FC<TitleSelectionProps> = ({
	titles,
	agent,
	selectedTitle,
	setSelectedTitle,
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
	// Create a stable key from titles to detect actual changes
	const titlesKey = useMemo(() => {
		return titles.sort().join('|');
	}, [titles]);

	// Track previous titles to detect when they change
	const prevTitlesRef = useRef<string>('');

	// Reset selection whenever component loads with new titles
	useEffect(() => {
		const isCompleted = completedSelections.has('title');

		// Reset if:
		// 1. Titles changed (different set of titles)
		// 2. Component is shown with titles and selection is not completed
		const shouldReset =
			titlesKey !== prevTitlesRef.current &&
			titles.length > 0 &&
			!isCompleted;

		if (shouldReset) {
			setSelectedTitle(null);
		}

		// Always update ref to track current titles
		prevTitlesRef.current = titlesKey;
	}, [titlesKey, titles.length, completedSelections, setSelectedTitle]);

	const handleConfirm = async () => {
		if (!agent || !selectedTitle) return;

		setCompletedSelections((prev) => new Set(prev).add('title'));

		// Add user message immediately for UI feedback
		const userMsg = {
			role: 'user' as const,
			content: `Select "${selectedTitle}" as title`,
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send selection to backend
			const result = await sendUserMessage(
				`Select "${selectedTitle}" as title`,
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
					...result.metadata,
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
		<div>
			<div className='font-inter text-[16px] font-normal text-[#777777] mb-[12px]'>Tip: You can also type your own Title in the chat if you prefer.</div>
			<div className='space-y-[3px] bg-[#FFFFFF] p-[16px] rounded-[10px] border border-offwhite'>
				{titles.map((title, idx) => {
					const isSelected = selectedTitle === title;
					return (
						<label
							key={idx}
							className={`relative flex items-center justify-between text-sm bg-white border  rounded-[8px]   cursor-pointer transition-colors hover:border-primary hover:bg-[#FFF8F1] ${
								isSelected
									? 'border-primary bg-[#FFF4E8]'
									: 'border-offwhite'
							}`}
						>
							<div className='px-[12px] py-[16px]'>

								<input
									type='radio'
									name='title'
									disabled={completedSelections.has(
										'title'
									)}
									checked={isSelected}
									onChange={() => setSelectedTitle(title)}
									className='w-4 h-4  text-primary focus:ring-primary border-primary'
									/>
									</div>
								<div className='flex-1 font-inter px-[10px] py-[17.5px] text-[14px] font-medium text-black'>{title}</div>
							
						</label>
					);
				})}
			</div>
			<div className='mt-3 text-left'>
				<button
					disabled={
						completedSelections.has('title') ||
						!selectedTitle
					}
					className='px-[18px] py-[8px] text-sm bg-success text-white  transition-colors disabled:opacity-[60%] disabled:cursor-not-allowed rounded-[26px]'
					onClick={handleConfirm}
				> 
					Confirm Selection
				</button>
			</div>
		</div>
	);
};

export default TitleSelection;
