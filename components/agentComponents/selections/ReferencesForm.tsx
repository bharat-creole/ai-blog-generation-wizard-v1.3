import React, { useState, useEffect } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { ReferenceFile, ChatMessage, BlogData } from '../../../types';
import { fileToBase64 } from '../utils/agentHelpers';
import { WhitePlusIcon } from '@/components/icons';

interface ReferencesFormProps {
	currentUrls: string[];
	currentFiles: ReferenceFile[];
	agent: AgentState | null;
	data: BlogData;
	showBlogContent: boolean;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
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

const ReferencesForm: React.FC<ReferencesFormProps> = ({
	currentUrls,
	currentFiles,
	agent,
	data,
	completedSelections,
	setCompletedSelections,
	setMessages,
	setAgent,
	updateData,
	setIsThinking,
	setOutline,
	setDraft,
	setTraceItems,
	sendUserMessage,
	showBlogContent
}) => {
	const [currentReferenceUrl, setCurrentReferenceUrl] = useState('');
	
	// Track if submit/skip button is being processed
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Use data.referenceUrls and data.referenceFiles as source of truth
	// If they're empty but currentUrls/currentFiles are provided, sync them on mount
	useEffect(() => {
		if (
			(!data.referenceUrls || data.referenceUrls.length === 0) &&
			currentUrls.length > 0
		) {
			updateData({ referenceUrls: currentUrls });
		}
		if (
			(!data.referenceFiles || data.referenceFiles.length === 0) &&
			currentFiles.length > 0
		) {
			updateData({ referenceFiles: currentFiles });
		}
	}, []); // Only run on mount

	// Use data.referenceUrls and data.referenceFiles for display (source of truth)
	const displayUrls = data.referenceUrls || [];
	const displayFiles = data.referenceFiles || [];

	const handleContinue = async () => {
		if (!agent) return;

		setIsSubmitting(true);
		setCompletedSelections((prev) => new Set(prev).add('references'));

		const userMsg = {
			role: 'user' as const,
			content:
				(data.referenceUrls?.length || 0) +
					(data.referenceFiles?.length || 0) >
				0
					? `Added ${
							data.referenceUrls?.length || 0
					  } URL(s) and ${
							data.referenceFiles?.length || 0
					  } file(s). Continue.`
					: 'Skip references',
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send to backend
			const result = await sendUserMessage(
				(data.referenceUrls?.length || 0) +
					(data.referenceFiles?.length || 0) >
					0
					? `Added ${
							data.referenceUrls?.length || 0
					  } URL(s) and ${
							data.referenceFiles?.length || 0
					  } file(s). Continue.`
					: 'Skip references',
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
			console.error('Error processing references:', error);
			// Revert on error
			setCompletedSelections((prev) => {
				const newSet = new Set(prev);
				newSet.delete('references');
				return newSet;
			});
		} finally {
			setIsThinking(false);
		}
	};

	const handleAddUrl = () => {
		if (currentReferenceUrl.trim()) {
			const url = currentReferenceUrl.trim();
			const currentUrls = data.referenceUrls || [];
			if (!currentUrls.includes(url)) {
				updateData({
					referenceUrls: [...currentUrls, url],
				});
				setCurrentReferenceUrl('');
			}
		}
	};

	const handleFileUpload = async (
		e: React.ChangeEvent<HTMLInputElement>
	) => {
		const file = e.target.files?.[0];
		if (file) {
			try {
				const base64 = await fileToBase64(file);
				const newFile: ReferenceFile = {
					name: file.name,
					mimeType: file.type,
					base64: base64,
				};
				updateData({
					referenceFiles: [
						...(data.referenceFiles || []),
						newFile,
					],
				});
				e.target.value = '';
			} catch (err) {
				console.error('Error reading file:', err);
			}
		}
	};

	// Ensure showBlogContent is always boolean
	const safeShowBlogContent = showBlogContent ? true : false;

	console.log("showBlogContent in ReferencesForm:", safeShowBlogContent);

	return (
		<div className=''>
			<div className={`grid gap-[12px] mb-[12px] ${safeShowBlogContent ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
				{/* URLs Section */}
				<div className=''>
					<div className='font-inter text-[16px] font-medium text-black mb-[4px]'>
						Reference External URLs
					</div>
					{displayUrls.length > 0 && (
						<div className='space-y-[4px] mb-[4px] max-h-32 overflow-y-auto'>
							{displayUrls.map((url, idx) => (
								<div className='flex flex-wrap gap-[10px]'>
									<div
										key={idx}
										className='flex-grow px-[14px] py-[10px] h-[46px] text-regular bg-offwhite rounded-[8px] border border-offwhite outline-none'
									>
										<span className='text-[14px] text-[#3330E4] truncate block max-w-[220px]' title={url}>
											{url}
										</span>
									</div>
									<button
										disabled={completedSelections.has('references') || isSubmitting}
										className='min-w-[84px] flex justify-center items-center text-white bg-alert_error rounded-[8px] p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
										onClick={() => {
											const currentUrls =
												data.referenceUrls ||
												[];
											updateData({
												referenceUrls:
													currentUrls.filter(
														(
															_,
															i
														) =>
															i !==
															idx
													),
											});
											}}
										>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
					<div className='flex flex-wrap gap-[10px]'>
						<input
							type='text'
							value={currentReferenceUrl}
							onChange={(e) =>
								setCurrentReferenceUrl(
									e.target.value
								)
							}
							onKeyDown={(e) => {
								if (
									e.key === 'Enter' &&
									currentReferenceUrl.trim()
								) {
									handleAddUrl();
								}
							}}
							disabled={completedSelections.has('references') || isSubmitting}
							placeholder='https://example.com/article'
							className='flex-grow flex-1 w-full px-[14px] py-[10px] h-[46px] font-inter text-black text-regular bg-white rounded-[8px] border border-offwhite outline-none placeholder:text-[14px] placeholder:text-[#777777] disabled:opacity-60 disabled:cursor-not-allowed'
						/>
						<button
							disabled={completedSelections.has('references') || isSubmitting}
							onClick={handleAddUrl}
							className='min-w-[84px] flex justify-center items-center text-white bg-success  rounded-[8px]  p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
						>
							<div className='flex gap-[8px] items-center'>
												<WhitePlusIcon/>
							<div>Add</div>
												</div>
						</button>
					</div>
				</div>

				{/* Files Section */}
				<div className=''>
					<div className='font-inter text-[16px] font-medium text-black mb-[4px]'>
						Upload Files (PDF/Docx)
					</div>
					{displayFiles.length > 0 && (
						<div className='space-y-[4px] mb-[4px] max-h-32 overflow-y-auto'>
							{displayFiles.map((file, idx) => (
								<div className='flex flex-wrap gap-[10px] '>

								<div
									key={idx}
									className='flex-grow px-[14px]  py-[10px] h-[46px] text-regular bg-offwhite rounded-[8px] border border-offwhite outline-none '
									>
									<span className='truncate block max-w-[220px]' title={file.name}>
										{file.name}
									</span>
									</div>
									<button
										disabled={completedSelections.has('references') || isSubmitting}
										className='min-w-[84px] flex justify-center items-center text-white bg-alert_error  rounded-[8px]  p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
										onClick={() => {
											const currentFiles =
												data.referenceFiles ||
												[];
											updateData({
												referenceFiles:
													currentFiles.filter(
														(
															_,
															i
														) =>
															i !==
															idx
														),
											});
										}}
										>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
					{/* Custom file input and Add button */}
					<div className='flex flex-wrap gap-[10px] items-center'>
						<label className={`flex-1 w-full relative h-[46px] ${(completedSelections.has('references') || isSubmitting) ? 'opacity-60 cursor-not-allowed' : ''}`}>
							<input
								type='file'
								accept='.pdf,.docx'
								onChange={handleFileUpload}
								disabled={completedSelections.has('references') || isSubmitting}
								className='absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 h-full disabled:cursor-not-allowed'
							/>
							<div className='w-full flex items-center px-[14px] py-[10px] bg-white border border-offwhite rounded-[8px] font-inter text-regular text-[14px] text-gray pointer-events-none'>
								{(() => {
									// Show selected file name or placeholder
									const input = document.querySelector("input[type='file']") as HTMLInputElement;
									return input && input.files && input.files[0] ? input.files[0].name : 'Choose File';
								})()}
							</div>
						</label>
						<button
							type='button'
							disabled={completedSelections.has('references') || isSubmitting}
							className='min-w-[84px] flex justify-center items-center text-white bg-success rounded-[8px]  p-[10px] min-h-[46px] disabled:bg-opacity-60 disabled:cursor-not-allowed'
							onClick={() => {
								// Trigger file input click
								const input = document.querySelector("input[type='file']") as HTMLInputElement;
								if (input) input.click();
							}}
						>
							<div className='flex gap-[8px] items-center'>
								<WhitePlusIcon />
								<div>Add</div>
							</div>
						</button>
					</div>
				</div>
			</div>

			<div className='text-left flex gap-[10px]'>
				
				<button
					disabled={completedSelections.has('references') || isSubmitting}
					className={` bg-primary text-white px-[18px] py-[8px] text-regular text-[14px] rounded-[26px] ${completedSelections.has('references') || isSubmitting
							? 'cursor-not-allowed opacity-60'
							: ' hover:bg-primary'
						}`}
					onClick={handleContinue}
				>
					Continue
				</button>
				<button
					disabled={completedSelections.has('references') || isSubmitting}
					className={` bg-lightgray text-black px-[18px] py-[8px] text-regular text-[14px] rounded-[26px] ${completedSelections.has('references') || isSubmitting
							? 'cursor-not-allowed opacity-60'
							: ' hover:bg-lightgray'
						}`}
					onClick={handleContinue}
				>
				Skip
				</button>
			</div>
		</div>
	);
};

export default ReferencesForm;
