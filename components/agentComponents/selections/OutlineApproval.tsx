import React from 'react';
import { AgentState } from '../../../services/langgraph/agentGraph';
import { runNext as lgRunNext } from '../../../services/langgraph/agentGraph';
import * as automationEngine from '../../../services/automationEngine';
import { OutlineSection, ChatMessage } from '../../../types';
import DraggableOutline from '../content/DraggableOutline';
import { getStepMessage } from '../utils/agentHelpers';

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
}) => {
	const handleApprove = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('outline'));
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: 'Approve outline',
			},
			{
				role: 'assistant',
				content: '✅ Outline approved! Starting blog generation...',
			},
		]);

		const next = {
			...agent,
			outlineApproved: true,
		} as AgentState;
		setAgent(next);
		setOutlineApproved(true);
		setViewMode('markdown');
		setShowBlogContent(true); // Show blog content immediately for animation
		setIsThinking(true);
		
		// Collapse sidebar when blog content appears
		if (onCollapseSidebar) {
			onCollapseSidebar();
		}

		try {
			let working = next;
			let guard = 0;
			let lastTraceLength = 0;

			while (guard++ < 50) {
				const { state: ns, halted, step } = await lgRunNext(working);
				working = ns;

				// Update live state during generation (for real-time content display)
				setAgent(working);
				setOutlineState(working.outline);
				setDraft(working.draft); // Update draft in real-time as content is generated
				setTraceItems(working.trace.map((t) => ({ step: t.step, at: t.at })));
				
				// Update blog data in real-time so content appears section by section
				if (working.draft && working.draft.trim().length > 0) {
					updateData({
						blogContent: working.draft,
						outline: working.outline,
					});
				}

				// Show progress messages
				if (working.trace.length > lastTraceLength) {
					const latestTrace = working.trace[working.trace.length - 1];
					const stepMessage = getStepMessage(latestTrace.step, latestTrace.info);

					if (stepMessage) {
						setMessages((prev) => [
							...prev,
							{
								role: 'assistant',
								content: stepMessage,
							},
						]);
						await new Promise((resolve) => setTimeout(resolve, 300));
					}
					lastTraceLength = working.trace.length;
				}

				// Break if halted and needs user input
				if (halted && automationEngine.needsUserInput(ns)) {
					break;
				}
			}

			// Final state update
			setAgent(working);
			setOutlineState(working.outline);
			setDraft(working.draft);
			setTraceItems(working.trace.map((t) => ({ step: t.step, at: t.at })));
			updateData({
				outline: working.outline,
				blogContent: working.draft,
			});

			// Show completion message
			if (working.finalBlogGenerated) {
				setMessages((prev) => [
					...prev,
					{
						role: 'assistant',
						content: '🎉 Blog generation complete! Your content is ready in the Live Draft.',
					},
				]);
			}
		} finally {
			setIsThinking(false);
		}
	};

	const handleOutlineChange = (newOutline: OutlineSection[]) => {
		// Update the outline in the message
		setMessages((prev) =>
			prev.map((msg, idx) =>
				idx === messages.findIndex((m2) => m2 === messages[messages.length - 1])
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

	return (
		<div className='mt-3'>
			<DraggableOutline outline={outline} onOutlineChange={handleOutlineChange} />

			<div className='flex gap-3'>
				<button
					disabled={completedSelections.has('outline')}
					className={`px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
						completedSelections.has('outline')
							? 'bg-gray-400 text-gray-200 cursor-not-allowed'
							: 'text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:shadow-lg hover:shadow-orange-500/30'
					}`}
					onClick={handleApprove}
				>
					✅ Approve Outline
				</button>
				<button
					className='px-4 py-3 text-sm font-semibold bg-gray-200 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-300 transition-all'
					onClick={() => {
						setInput('Regenerate the outline with more detail');
					}}
				>
					💬 Request Changes
				</button>
			</div>

			<div className='mt-3 text-xs text-gray-600 bg-blue-50 p-2 rounded'>
				💡 <strong>Tip:</strong> Type feedback like "Add a section about X" or "Make it more technical" to regenerate
			</div>
		</div>
	);
};

export default OutlineApproval;

