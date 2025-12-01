import React from 'react';
import Spinner from '../../common/Spinner';
import { ChatMessage } from '../../../types';
import { AgentState } from '../../../../server/agent/state';
import { BlogData } from '../../../types';
import { MessageRenderer } from './MessageRenderer';
import { ChatInput } from './ChatInput';

/**
 * Props for ChatInterface component
 */
interface ChatInterfaceProps {
	messages: ChatMessage[];
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
	input: string;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	canSend: boolean;
	isInputLocked: boolean;
	outlineApproved: boolean;
	isStreaming: boolean;
	isThinking: boolean;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: Partial<BlogData>) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<
		React.SetStateAction<Array<{ step: string; at: number }>>
	>;
	setOutlineApproved: React.Dispatch<React.SetStateAction<boolean>>;
	setViewMode: React.Dispatch<
		React.SetStateAction<'outline' | 'blog' | 'markdown'>
	>;
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
	onSend: () => void;
	scrollRef: React.RefObject<HTMLDivElement>;
	showBlogContent: boolean;
	setShowBlogContent: React.Dispatch<React.SetStateAction<boolean>>;
	onCollapseSidebar?: () => void;
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
}

/**
 * Chat interface component that displays messages and input
 * 
 * Main chat UI component that:
 * - Renders all chat messages using MessageRenderer
 * - Shows thinking indicator when agent is processing
 * - Provides chat input with send functionality
 * - Handles scrolling to latest message
 * - Adapts width based on blog content visibility
 * - 
 * @param props - ChatInterfaceProps containing all necessary state and handlers
 * @returns JSX.Element - Chat interface component
 */
export const ChatInterface: React.FC<ChatInterfaceProps> = ({
	messages,
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
	input,
	setInput,
	canSend,
	isInputLocked,
	outlineApproved,
	isStreaming,
	isThinking,
	setMessages,
	setAgent,
	updateData,
	setIsThinking,
	setOutline,
	setDraft,
	setTraceItems,
	setOutlineApproved,
	setViewMode,
	setIsStreaming,
	onSend,
	scrollRef,
	showBlogContent,
	setShowBlogContent,
	onCollapseSidebar,
	sendUserMessage,
}) => {
	return (
		<div
			className={`flex flex-col min-h-0 transition-all duration-700 ease-in-out ${showBlogContent ? 'w-[30%]' : 'w-full'
				} ${showBlogContent
					? 'border-2 border-orange-300 rounded-xl bg-white shadow-lg'
					: ''
				}`}
		>
			<div className='flex-1 overflow-y-auto py-3 px-4'>
				{messages.map((m, i) => (
					<div
						key={i}
						className={`mb-4 ${m.role === 'user'
								? 'flex justify-end'
								: 'flex justify-start'
							}`}
					>
						<MessageRenderer
							message={m}
							agent={agent}
							data={data}
							selectedSecondaries={selectedSecondaries}
							setSelectedSecondaries={setSelectedSecondaries}
							selectedPrimary={selectedPrimary}
							setSelectedPrimary={setSelectedPrimary}
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
							setInput={setInput}
							setOutlineApproved={setOutlineApproved}
							setViewMode={setViewMode}
							messages={messages}
							isStreaming={isStreaming}
							setIsStreaming={setIsStreaming}
							setShowBlogContent={setShowBlogContent}
							onCollapseSidebar={onCollapseSidebar}
							sendUserMessage={sendUserMessage}
						/>
					</div>
				))}
				{isThinking && (
					<div className='flex justify-start mb-4'>
						<div className='bg-gray-100 text-gray-800 max-w-[75%] px-4 py-2.5 rounded-xl flex items-center gap-2'>
							<Spinner className='w-4 h-4' />
							<span className='text-sm'>Thinking...</span>
						</div>
					</div>
				)}
				<div ref={scrollRef} />
			</div>

			<ChatInput
				input={input}
				setInput={setInput}
				canSend={canSend}
				isInputLocked={isInputLocked}
				outlineApproved={outlineApproved}
				isStreaming={isStreaming}
				isThinking={isThinking}
				onSend={onSend}
			/>
		</div>
	);
};

