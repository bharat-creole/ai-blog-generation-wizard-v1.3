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
    <div className="sticky bottom-0 left-0 right-0 py-4 bg-gradient-to-t from-white via-white to-transparent">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex gap-2 justify-center items-end p-[10px] rounded-[30px] border border-lightgray bg-off-white shadow-sm focus-within:border-primary focus-within:shadow-sm transition-all">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
						disabled={isInputLocked}
						placeholder={placeholder}
            className={`flex-1 font-inter text-[14px] pl-[12px] font-normal placeholder-[#777777]  focus:ring-0 focus:outline-none resize-none bg-transparent  ${
              isInputLocked ? "cursor-not-allowed opacity-60" : ""
						}`}
						style={inputTextareaStyles}
					/>
					<button
						onClick={onSend}
						disabled={!canSend || isThinking || isStreaming}
            className="p-[9.67px] text-white bg-orange-500 rounded-full hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-500"
            title="Send message"
					>
						<svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
						>
							<path
                d="M9.72869 0.0406971C10.2843 -0.153443 10.8181 0.380307 10.6239 0.935932L7.38369 10.1945C7.17315 10.795 6.33643 10.8289 6.0783 10.2476L4.51479 6.73007L6.71541 4.5289C6.78786 4.45115 6.8273 4.34831 6.82543 4.24205C6.82355 4.13579 6.78051 4.03441 6.70536 3.95926C6.63021 3.88412 6.52883 3.84107 6.42257 3.8392C6.31631 3.83732 6.21348 3.87676 6.13573 3.94921L3.93455 6.14984L0.417053 4.58632C-0.164275 4.32765 -0.129822 3.49148 0.470099 3.28093L9.72869 0.0406971Z"
                fill="white"
							/>
						</svg>
					</button>
				</div>
				{isThinking && !outlineApproved && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 px-4">
						<span>Assistant is responding...</span>
					</div>
				)}
			</div>
		</div>
	);
};

