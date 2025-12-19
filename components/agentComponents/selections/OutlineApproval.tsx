import React, { useState } from 'react';
import { AgentState } from '../../../server/agent/state';
import { OutlineSection, ChatMessage } from '../../../types';
import DraggableOutline from '../content/DraggableOutline';

interface OutlineApprovalProps {
	outline: OutlineSection[];
	agent: AgentState | null;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	messages: ChatMessage[];
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setOutline: React.Dispatch<React.SetStateAction<OutlineSection[]>>;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	setViewMode: React.Dispatch<React.SetStateAction<string>>;
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
	onCollapseSidebar?: () => void;
	sendUserMessage: (
		message: string,
		agentState: AgentState
	) => Promise<{
		response: string;
		updatedState: AgentState;
		metadata?: any;
	}>;
}

const OutlineApproval: React.FC<OutlineApprovalProps> = ({
	outline,
	agent,
	completedSelections,
	setCompletedSelections,
	setMessages,
	messages,
	setAgent,
	updateData,
	setOutline: setOutlineState,
	setIsThinking,
	setDraft,
	setTraceItems,
	setInput,
	setOutlineApproved,
	setViewMode,
	setShowBlogContent,
	onCollapseSidebar,
	sendUserMessage,
}) => {
	// Track if submit button is being processed
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleApprove = async () => {
		if (!agent) return;

		setIsSubmitting(true);
		setCompletedSelections((prev) => new Set(prev).add('outline'));

		// Add user message immediately
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: 'Approve outline',
			},
			{
				role: 'assistant',
				content: '✅ Outline approved! Starting blog generation... This may take a minute or two as I write each section.',
			},
		]);

		// Update local state immediately for UI feedback
		setOutlineApproved(true);
		setViewMode('markdown');
		setShowBlogContent(true);
		setIsThinking(true);

		// Collapse sidebar when blog content appears
		if (onCollapseSidebar) {
			onCollapseSidebar();
		}

		try {
			// Send approval to backend - this will trigger the full generation loop
			const result = await sendUserMessage(
				'Approve outline',
				agent
			);

			// Update state with the fully generated blog
			setAgent(result.updatedState);
			setOutlineState(result.updatedState.outline);
			setDraft(result.updatedState.draft);

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
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Check if blog generation is complete
			const currentSectionIndex = result.updatedState.progress?.sectionIndex ?? 0;
			const totalSections = result.updatedState.outline?.length ?? 0;
			const isBlogComplete =
				result.updatedState.outlineApproved &&
				result.updatedState.outline &&
				totalSections > 0 &&
				currentSectionIndex >= totalSections;

			// ✨ SIMPLE APPROACH: Only turn off loader when ALL sections are complete
			if (isBlogComplete) {
				setIsThinking(false);
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: '✅ **Blog generation completed!**\n\nYour blog post is ready for review. Check the Live Draft panel to see the full content.',
						...result.metadata,
					},
				]);
			} else {
				// Keep loader ON during blog generation - useAgentExecutionV3 will manage it
				setIsThinking(true);
			}
			// If not complete, don't show result.response as it contains duplicate "Starting blog generation..." message
		} catch (error) {
			console.error('Error approving outline:', error);
			// Revert on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('outline');
				return newSet;
			});
			setOutlineApproved(false);
			setShowBlogContent(false);
			// Only turn off loader on error
			setIsThinking(false);
		}
		// Don't turn off loader in finally - let useAgentExecutionV3 manage it during blog generation
	};

	const handleOutlineChange = (newOutline: OutlineSection[]) => {
		// Update the outline in the message
		setMessages((prev) =>
			prev.map((msg, idx) =>
				idx ===
				messages.findIndex(
					(m2) => m2 === messages[messages.length - 1]
				)
					? {
							...msg,
							outlineApproval: {
								outline: newOutline,
							},
					  }
					: msg
			)
		);

		// Update the agent state
		if (agent) {
			setAgent({
				...agent,
				outline: newOutline,
			});
		}

		// Update the outline state
		setOutlineState(newOutline);

		// Persist to data
		updateData({
			outline: newOutline,
		});
	};

	if (!outline) return null;

	const isDisabled = completedSelections.has('outline') || isSubmitting;

	return (
		<div className='mt-3'>
			<div className={isDisabled ? 'opacity-60 pointer-events-none' : ''}>
				<DraggableOutline
					outline={outline}
					onOutlineChange={handleOutlineChange}
				/>
			</div>

			<div className='flex gap-[10px] border-t border-lightgray p-[10px] mt-[14px]'>
				<button
					disabled={isDisabled}
					className={`px-[18px] py-[8px] text-[14px]  font-semibold rounded-[26px] transition-all duration-200 ${isDisabled
							? 'text-white bg-primary hover:shadow-lg cursor-not-allowed opacity-60'
							: 'text-white bg-primary hover:shadow-lg '
						}`}
					onClick={handleApprove}
				>
					✅ Approve Outline
				</button>
				<button
					disabled={isDisabled}
					className={`px-[18px] py-[8px] text-[14px] font-semibold bg-offwhite text-black border border-lightgray rounded-[26px]  transition-all ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
					onClick={() => {
						setInput(
							'Regenerate the outline with more detail'
						);
					}}
				>
					✍️ Request Changes
				</button>
			</div>

			
		</div>
	);
};

export default OutlineApproval;
