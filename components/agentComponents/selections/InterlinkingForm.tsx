import React, { useState } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { Interlink, ChatMessage, BlogData } from '../../../types';
import { WhitePlusIcon } from '@/components/icons';

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
	sendUserMessage: (
		message: string,
		agentState: AgentState
	) => Promise<{
		response: string;
		updatedState: AgentState;
		metadata?: any;
	}>;
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
	const [buttonsDisabled, setButtonsDisabled] = useState(false);

	const handleContinue = async () => {
		if (!agent) return;
		setButtonsDisabled(true);
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
					if (
						i === messages.length - 1 &&
						msg.interlinkingForm
					) {
						return {
							...msg,
							interlinkingForm: {
								currentLinks: [
									...data.interlinks,
									newLink,
								],
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
							currentLinks: data.interlinks.filter(
								(l) => l.id !== linkId
							),
						},
					};
				}
				return msg;
			})
		);
	};

	return (
		<div className=''>
				<div className='font-inter text-[16px] font-medium text-black mb-[4px]'>
				Internal links
			</div>
			{currentLinks && currentLinks.length > 0 && (
				<div className='space-y-2 mb-[12px]'>
					{currentLinks.map((link) => (
						<div
							key={link.id}
							className='flex  gap-[10px]'
						>
							<div className='flex flex-grow gap-2 flex-wrap'>
								<div className='flex-grow flex-1 w-full px-[14px] py-[10px] h-[46px] font-inter text-black text-regular bg-offwhite rounded-[8px] border border-offwhite outline-none truncate block overflow-hidden whitespace-nowrap' title={link.keyword}>
									{link.keyword}
								</div>
								<div className='flex-grow flex-1 w-full px-[14px] py-[10px] h-[46px] font-inter text-[#3330E4] text-regular bg-offwhite rounded-[8px] border border-offwhite outline-none truncate block overflow-hidden whitespace-nowrap' title={link.url}>
									{link.url}
								</div>
							</div>
							
							<button
								className='min-w-[84px] flex justify-center items-center text-white bg-alert_error rounded-[8px] p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
								onClick={() =>
									handleRemoveLink(link.id)
								}
							>
								Remove
							</button>
						</div>
					))}
				</div>
			)}


			<div className='flex gap-2 mb-[12px]'>
				<input
					type='text'
					placeholder='Keyword/Anchor Text'
					value={interlinkKeyword}
					onChange={(e) =>
						setInterlinkKeyword(e.target.value)
					}
					className='flex-grow flex-1 w-full px-[14px] py-[10px] h-[46px] font-inter text-black text-regular bg-white rounded-[8px] border border-offwhite outline-none placeholder:text-[14px] placeholder:text-[#777777] disabled:opacity-60 disabled:cursor-not-allowed'
				/>
				<input
					type='text'
					placeholder='Enter URL here...'
					value={interlinkUrl}
					onChange={(e) => setInterlinkUrl(e.target.value)}
					className='flex-grow flex-1 w-full px-[14px] py-[10px] h-[46px] font-inter text-black text-regular bg-white rounded-[8px] border border-offwhite outline-none placeholder:text-[14px] placeholder:text-[#777777] disabled:opacity-60 disabled:cursor-not-allowed'
				/>
				<button
					className='min-w-[84px] flex justify-center items-center text-white bg-success  rounded-[36px]  p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
					disabled={
						!interlinkKeyword.trim() ||
						!interlinkUrl.trim()
					}
					onClick={handleAddLink}
				>
					
				<div className='flex gap-[8px] items-center'>
					<WhitePlusIcon/>
				   <div>Add</div>
				</div>
				</button>
			</div>

		

			<div className='text-left flex gap-[10px]'>
				
				<button
					disabled={buttonsDisabled || completedSelections.has('interlinking') || currentLinks.length === 0}
					className={` bg-primary text-white px-[18px] py-[8px] text-regular text-[14px] rounded-[26px] ${buttonsDisabled || completedSelections.has('interlinking') || currentLinks.length === 0
							? 'cursor-not-allowed opacity-60'
							: ' hover:bg-primary'
					}`}
					onClick={handleContinue}
				>
					Continue
					{data.interlinks.length > 0 &&
						`(${data.interlinks.length} links)`}
				</button>
				<button
					disabled={buttonsDisabled || completedSelections.has('interlinking') || currentLinks.length > 0}
					className={` bg-primary text-white px-[18px] py-[8px] text-regular text-[14px] rounded-[26px] ${buttonsDisabled || completedSelections.has('interlinking') || currentLinks.length > 0
							? 'cursor-not-allowed opacity-60'
							: ' hover:bg-primary'
						}`}
					onClick={handleContinue}
				>
					Skip
					
				</button>
				
			</div>
		</div>
	);
};

export default InterlinkingForm;
