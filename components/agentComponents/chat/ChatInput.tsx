import React from 'react';
import { inputTextareaStyles } from '../styles/agentModeStyles';

/**
 * Props for ChatInput component
 */
interface ChatInputProps {
	input: string;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	canSend: boolean;
	isInputLocked: boolean;
	outlineApproved: boolean;
	isStreaming: boolean;
	isThinking: boolean;
	onSend: () => void;
}

/**
 * Chat input component with send button
 */
export const ChatInput: React.FC<ChatInputProps> = ({
	input,
	setInput,
	canSend,
	isInputLocked,
	outlineApproved,
	isStreaming,
	isThinking,
	onSend,
}) => {
	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (canSend && !isThinking) {
				onSend();
			}
		}
	};

	const placeholder = outlineApproved
		? 'Chat disabled - Blog generation in progress...'
		: isStreaming
		? 'Assistant is streaming response...'
		: isThinking
		? 'Assistant is responding...'
		: 'Message Bloggr AI...';

	return (
		<div className='sticky bottom-0 left-0 right-0 py-4 bg-gradient-to-t from-white via-white to-transparent'>
			<div className='max-w-3xl mx-auto px-4'>
				<div className='flex gap-2 items-end p-3 rounded-2xl border border-gray-300 bg-white shadow-lg focus-within:border-orange-400 focus-within:shadow-xl transition-all'>
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
						disabled={isInputLocked}
						placeholder={placeholder}
						className={`flex-1 px-2 py-2 border-0 focus:ring-0 focus:outline-none resize-none bg-transparent text-gray-900 placeholder-gray-400 ${
							isInputLocked
								? 'cursor-not-allowed opacity-60'
								: ''
						}`}
						style={inputTextareaStyles}
					/>
					<button
						onClick={onSend}
						disabled={!canSend || isThinking || isStreaming}
						className='p-2 text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-500'
						title='Send message'
					>
						<svg
							className='w-5 h-5'
							fill='none'
							stroke='currentColor'
							viewBox='0 0 24 24'
						>
							<path
								strokeLinecap='round'
								strokeLinejoin='round'
								strokeWidth={2}
								d='M5 12h14M12 5l7 7-7 7'
							/>
						</svg>
					</button>
				</div>
				{isThinking && !outlineApproved && (
					<div className='mt-2 flex items-center gap-2 text-xs text-gray-500 px-4'>
						<span>Assistant is responding...</span>
					</div>
				)}
			</div>
		</div>
	);
};

