import React, { useState } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { Interlink, ChatMessage, BlogData } from '../../../types';

interface InterlinkingFormProps {
	currentLinks: Interlink[];
	agent: AgentState | null;
	data: BlogData;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	messages: ChatMessage[];
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
}

const InterlinkingForm: React.FC<InterlinkingFormProps> = ({
	currentLinks,
	agent,
	data,
	completedSelections,
	setCompletedSelections,
	setMessages,
	messages,
	setAgent,
	updateData,
	setIsThinking,
	setOutline,
	setDraft,
	setTraceItems,
	sendUserMessage,
}) => {
	const [interlinkKeyword, setInterlinkKeyword] = useState('');
	const [interlinkUrl, setInterlinkUrl] = useState('');

	const handleContinue = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('interlinking'));

		const userMsg = {
			role: 'user' as const,
			content:
				data.interlinks.length > 0
					? `Added ${data.interlinks.length} link(s). Continue.`
					: 'Skip interlinking',
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send to backend
			const result = await sendUserMessage(
				data.interlinks.length > 0
					? `Added ${data.interlinks.length} link(s). Continue.`
					: 'Skip interlinking',
				agent
			);

			// Update state from backend response
			setAgent(result.updatedState);
			setOutline(result.updatedState.outline);
			setDraft(result.updatedState.draft);

			if (result.updatedState.trace) {
				setTraceItems(result.updatedState.trace.map((t) => ({ step: t.step, at: t.at })));
			}

			// Update parent data
			updateData({
				outline: result.updatedState.outline,
				blogContent: result.updatedState.draft,
			});

			// Add assistant response
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: result.response,
					...result.metadata
				},
			]);

		} catch (error) {
			console.error('Error processing interlinking:', error);
			// Revert on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('interlinking');
				return newSet;
			});
		} finally {
			setIsThinking(false);
		}
	};

	const handleAddLink = () => {
		if (interlinkKeyword.trim() && interlinkUrl.trim()) {
			const newLink: Interlink = {
				id: Date.now().toString(),
				keyword: interlinkKeyword.trim(),
				url: interlinkUrl.trim(),
			};
			updateData({
				interlinks: [...data.interlinks, newLink],
			});
			// Update the message to reflect the change
			setMessages((prev) =>
				prev.map((msg, i) => {
					if (i === messages.length - 1 && msg.interlinkingForm) {
						return {
							...msg,
							interlinkingForm: {
								currentLinks: [...data.interlinks, newLink],
							},
						};
					}
					return msg;
				})
			);
			setInterlinkKeyword('');
			setInterlinkUrl('');
		}
	};

	const handleRemoveLink = (linkId: string) => {
		updateData({
			interlinks: data.interlinks.filter((l) => l.id !== linkId),
		});
		// Update the message to reflect the change
		setMessages((prev) =>
			prev.map((msg, i) => {
				if (i === messages.length - 1 && msg.interlinkingForm) {
					return {
						...msg,
						interlinkingForm: {
							currentLinks: data.interlinks.filter((l) => l.id !== linkId),
						},
					};
				}
				return msg;
			})
		);
	};

	return (
		<div className='mt-3'>
			{currentLinks && currentLinks.length > 0 && (
				<div className='space-y-2 mb-3'>
					{currentLinks.map((link) => (
						<div
							key={link.id}
							className='flex items-center justify-between text-sm bg-white border rounded p-2'
						>
							<div>
								<div className='font-medium text-gray-800'>{link.keyword}</div>
								<div className='text-xs text-blue-600 break-all'>{link.url}</div>
							</div>
							<button
								className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors'
								onClick={() => handleRemoveLink(link.id)}
							>
								Remove
							</button>
						</div>
					))}
				</div>
			)}

			<div className='flex gap-2 mb-3'>
				<input
					type='text'
					placeholder='Keyword/Anchor Text'
					value={interlinkKeyword}
					onChange={(e) => setInterlinkKeyword(e.target.value)}
					className='flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500'
				/>
				<input
					type='text'
					placeholder='URL'
					value={interlinkUrl}
					onChange={(e) => setInterlinkUrl(e.target.value)}
					className='flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500'
				/>
				<button
					className='px-3 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed'
					disabled={!interlinkKeyword.trim() || !interlinkUrl.trim()}
					onClick={handleAddLink}
				>
					Add
				</button>
			</div>

			<div className='text-right'>
				<button
					disabled={completedSelections.has('interlinking')}
					className={`px-4 py-2 text-sm text-white rounded transition-colors ${completedSelections.has('interlinking')
							? 'bg-gray-400 cursor-not-allowed'
							: 'bg-green-600 hover:bg-green-700'
						}`}
					onClick={handleContinue}
				>
					Continue (skip){' '}
					{data.interlinks.length > 0 && `(${data.interlinks.length} links)`}
				</button>
			</div>
		</div>
	);
};

export default InterlinkingForm;

