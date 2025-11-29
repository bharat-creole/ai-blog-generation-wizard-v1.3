import React from 'react';
import { AgentState } from '../../../../server/agent/state';
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
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
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
	const handleApprove = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('outline'));

		// Add user message immediately
		// Note: Assistant response will be added by useAgentExecutionV3 hook
		setMessages((prev) => [
			...prev,
			{
				role: 'user',
				content: 'Approve outline',
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
				setTraceItems(result.updatedState.trace.map((t) => ({ step: t.step, at: t.at })));
			}

			// Update parent data
			updateData({
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Note: Assistant message is already added by useAgentExecutionV3 hook

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
					className={`px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${completedSelections.has('outline')
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

