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
	completedSelections: Set<string>;
	setSelectedSecondaries: React.Dispatch<React.SetStateAction<string[]>>;
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
	completedSelections,
	setSelectedSecondaries,
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

	return (
		<div className={messageClasses}>
			{/* Render message content */}
			{isAssistant && !hasMetadata ? (
				<StreamingText
					text={message.content}
					speed={15}
					onComplete={() => setIsStreaming(false)}
				/>
			) : (
				message.content
			)}

			{/* Primary Keyword Selection */}
			{message.keywordSelection?.type === 'primary' && (
				<PrimaryKeywordSelection
					candidates={message.keywordSelection.candidates}
					agent={agent}
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

