import React from 'react';
import StreamingText from '../../StreamingText';
import { ChatMessage } from '../../../types';
import { AgentState } from '../../../../server/agent/state';
import { BlogData } from '../../../types';
import PrimaryKeywordSelection from '../selections/PrimaryKeywordSelection';
import SecondaryKeywordSelection from '../selections/SecondaryKeywordSelection';
import TitleSelection from '../selections/TitleSelection';
import InterlinkingForm from '../selections/InterlinkingForm';
import ReferencesForm from '../selections/ReferencesForm';
import OutlineApproval from '../selections/OutlineApproval';

/**
 * Props for MessageRenderer component
 */
interface MessageRendererProps {
	message: ChatMessage;
	agent: AgentState | null;
	data: BlogData;
	selectedSecondaries: string[];
	setSelectedSecondaries: React.Dispatch<React.SetStateAction<string[]>>;
	selectedPrimary: string | null;
	setSelectedPrimary: React.Dispatch<React.SetStateAction<string | null>>;
	selectedTitle: string | null;
	setSelectedTitle: React.Dispatch<React.SetStateAction<string | null>>;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: Partial<BlogData>) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<
		React.SetStateAction<Array<{ step: string; at: number }>>
	>;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	setViewMode: React.Dispatch<
		React.SetStateAction<'outline' | 'blog' | 'markdown'>
	>;
	messages: ChatMessage[];
	isStreaming: boolean;
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
	onCollapseSidebar?: () => void;
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
}

/**
 * Component to render individual chat messages with conditional components
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	message,
	agent,
	data,
	selectedSecondaries,
	setSelectedSecondaries,
	selectedPrimary,
	setSelectedPrimary,
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
	setInput,
	setOutlineApproved,
	setViewMode,
	messages,
	isStreaming,
	setIsStreaming,
	setShowBlogContent,
	onCollapseSidebar,
	sendUserMessage,
}) => {
	const isAssistant = message.role === 'assistant';
	const isSystem = message.role === 'system';
	const hasMetadata =
		message.keywordSelection ||
		message.titleSelection ||
		message.interlinkingForm ||
		message.referencesForm ||
		message.outlineApproval ||
		message.controlLevelSelection;

	const messageClasses = `px-4 py-2.5 rounded-xl text-sm whitespace-pre-wrap ${isSystem
			? 'bg-blue-50 text-blue-700 border border-blue-100 w-full text-xs font-mono my-1'
			: message.role === 'user'
				? 'bg-orange-500 text-white max-w-[75%]'
				: hasMetadata
					? 'bg-gray-100 border border-gray-200 max-w-full w-full'
					: 'bg-gray-100 text-gray-800 max-w-[75%]'
		}`;

	// Log when message is being rendered
	React.useEffect(() => {
		if (isAssistant && message.content) {
			// Check if this is a pre-message (contains "Generating" or emoji indicators)
			if (message.content.includes('🔍') || 
				message.content.includes('📝') || 
				message.content.includes('📋') || 
				message.content.includes('✍️') ||
				message.content.includes('Generating')) {
				console.log(`🎨 [UI RENDER] Pre-message being displayed: "${message.content}"`, {
					timestamp: new Date().toISOString(),
					hasMetadata,
					role: message.role
				});
			}
		}
	}, [message.content, isAssistant, hasMetadata]);

	// Get streaming completion callback from message metadata
	const streamingCompleteCallback = (message as any)._streamingCompleteCallback;
	const messageId = (message as any)._messageId;
	const callbackCalledRef = React.useRef<string | null>(null);

	// For non-streaming messages (with metadata), call callback immediately after render
	// These messages don't stream, so we can proceed to next message right away
	React.useEffect(() => {
		if (streamingCompleteCallback && hasMetadata && messageId && callbackCalledRef.current !== messageId) {
			// Use a small timeout to ensure the message is rendered first
			const timer = setTimeout(() => {
				callbackCalledRef.current = messageId;
				streamingCompleteCallback();
			}, 50);
			return () => clearTimeout(timer);
		}
	}, [streamingCompleteCallback, hasMetadata, messageId]);

	return (
		<div className={messageClasses}>
			{/* Render message content */}
			{isAssistant && !hasMetadata ? (
				<StreamingText
					text={message.content}
					speed={15}
					onComplete={() => {
						setIsStreaming(false);
						// Call the queue callback to trigger next message
						// Only call if not already called (safeguard)
						if (streamingCompleteCallback && messageId && callbackCalledRef.current !== messageId) {
							callbackCalledRef.current = messageId;
							streamingCompleteCallback();
						}
					}}
				/>
			) : (
				message.content
			)}

			{/* Primary Keyword Selection */}
			{message.keywordSelection?.type === 'primary' && (
				<PrimaryKeywordSelection
					candidates={message.keywordSelection.candidates}
					agent={agent}
					selectedPrimary={selectedPrimary}
					setSelectedPrimary={setSelectedPrimary}
					completedSelections={completedSelections}
					setCompletedSelections={setCompletedSelections}
					setMessages={setMessages}
					setAgent={setAgent}
					updateData={updateData}
					setIsThinking={setIsThinking}
					setOutline={setOutline}
					setDraft={setDraft}
					setTraceItems={setTraceItems}
					sendUserMessage={sendUserMessage}
				/>
			)}

			{/* Secondary Keyword Selection */}
			{message.keywordSelection?.type === 'secondary' && (
				<SecondaryKeywordSelection
					candidates={message.keywordSelection.candidates}
					agent={agent}
					selectedSecondaries={selectedSecondaries}
					setSelectedSecondaries={setSelectedSecondaries}
					completedSelections={completedSelections}
					setCompletedSelections={setCompletedSelections}
					setMessages={setMessages}
					setAgent={setAgent}
					updateData={updateData}
					setIsThinking={setIsThinking}
					setOutline={setOutline}
					setDraft={setDraft}
					setTraceItems={setTraceItems}
					sendUserMessage={sendUserMessage}
				/>
			)}

			{/* Title Selection */}
			{message.titleSelection &&
				message.titleSelection.titles &&
				message.titleSelection.titles.length > 0 && (
					<TitleSelection
						titles={message.titleSelection.titles}
						agent={agent}
						selectedTitle={selectedTitle}
						setSelectedTitle={setSelectedTitle}
						completedSelections={completedSelections}
						setCompletedSelections={setCompletedSelections}
						setMessages={setMessages}
						setAgent={setAgent}
						updateData={updateData}
						setIsThinking={setIsThinking}
						setOutline={setOutline}
						setDraft={setDraft}
						setTraceItems={setTraceItems}
						sendUserMessage={sendUserMessage}
					/>
				)}

			{/* Interlinking Form */}
			{message.interlinkingForm && (
				<InterlinkingForm
					currentLinks={message.interlinkingForm.currentLinks || []}
					agent={agent}
					data={data}
					completedSelections={completedSelections}
					setCompletedSelections={setCompletedSelections}
					setMessages={setMessages}
					messages={messages}
					setAgent={setAgent}
					updateData={updateData}
					setIsThinking={setIsThinking}
					setOutline={setOutline}
					setDraft={setDraft}
					setTraceItems={setTraceItems}
					sendUserMessage={sendUserMessage}
				/>
			)}

			{/* References Form */}
			{message.referencesForm && (
				<ReferencesForm
					currentUrls={message.referencesForm.currentUrls || []}
					currentFiles={message.referencesForm.currentFiles || []}
					agent={agent}
					data={data}
					completedSelections={completedSelections}
					setCompletedSelections={setCompletedSelections}
					setMessages={setMessages}
					setAgent={setAgent}
					updateData={updateData}
					setIsThinking={setIsThinking}
					setOutline={setOutline}
					setDraft={setDraft}
					setTraceItems={setTraceItems}
					sendUserMessage={sendUserMessage}
				/>
			)}

			{/* Outline Approval */}
			{message.outlineApproval && message.outlineApproval.outline && (
				<OutlineApproval
					outline={message.outlineApproval.outline}
					agent={agent}
					completedSelections={completedSelections}
					setCompletedSelections={setCompletedSelections}
					setMessages={setMessages}
					messages={messages}
					setAgent={setAgent}
					updateData={updateData}
					setOutline={setOutline}
					setIsThinking={setIsThinking}
					setDraft={setDraft}
					setTraceItems={setTraceItems}
					setInput={setInput}
					setOutlineApproved={setOutlineApproved}
					setViewMode={setViewMode}
					setShowBlogContent={setShowBlogContent}
					onCollapseSidebar={onCollapseSidebar}
					sendUserMessage={sendUserMessage}
				/>
			)}
		</div>
	);
};

