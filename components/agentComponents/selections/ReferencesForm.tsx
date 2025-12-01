import React, { useState, useEffect } from 'react';
import { AgentState } from '../../../../server/agent/state';
import { ReferenceFile, ChatMessage, BlogData } from '../../../types';
import { fileToBase64 } from '../utils/agentHelpers';

interface ReferencesFormProps {
	currentUrls: string[];
	currentFiles: ReferenceFile[];
	agent: AgentState | null;
	data: BlogData;
	completedSelections: Set<string>;
	setCompletedSelections: React.Dispatch<React.SetStateAction<Set<string>>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setAgent: React.Dispatch<React.SetStateAction<AgentState | null>>;
	updateData: (data: any) => void;
	setIsThinking: React.Dispatch<React.SetStateAction<boolean>>;
	setOutline: React.Dispatch<React.SetStateAction<any[]>>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	setTraceItems: React.Dispatch<React.SetStateAction<any[]>>;
	sendUserMessage: (message: string, agentState: AgentState) => Promise<{ response: string; updatedState: AgentState; metadata?: any }>;
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
}) => {
	const [currentReferenceUrl, setCurrentReferenceUrl] = useState('');

	// Use data.referenceUrls and data.referenceFiles as source of truth
	// If they're empty but currentUrls/currentFiles are provided, sync them on mount
	useEffect(() => {
		if ((!data.referenceUrls || data.referenceUrls.length === 0) && currentUrls.length > 0) {
			updateData({ referenceUrls: currentUrls });
		}
		if ((!data.referenceFiles || data.referenceFiles.length === 0) && currentFiles.length > 0) {
			updateData({ referenceFiles: currentFiles });
		}
	}, []); // Only run on mount

	// Use data.referenceUrls and data.referenceFiles for display (source of truth)
	const displayUrls = data.referenceUrls || [];
	const displayFiles = data.referenceFiles || [];

	const handleContinue = async () => {
		if (!agent) return;

		setCompletedSelections((prev) => new Set(prev).add('references'));

		const userMsg = {
			role: 'user' as const,
			content:
				(data.referenceUrls?.length || 0) + (data.referenceFiles?.length || 0) > 0
					? `Added ${data.referenceUrls?.length || 0} URL(s) and ${data.referenceFiles?.length || 0} file(s). Continue.`
					: 'Skip references',
		};

		setMessages((prev) => [...prev, userMsg]);
		setIsThinking(true);

		try {
			// Send to backend
			const result = await sendUserMessage(
				(data.referenceUrls?.length || 0) + (data.referenceFiles?.length || 0) > 0
					? `Added ${data.referenceUrls?.length || 0} URL(s) and ${data.referenceFiles?.length || 0} file(s). Continue.`
					: 'Skip references',
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

	const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
					referenceFiles: [...(data.referenceFiles || []), newFile],
				});
				e.target.value = '';
			} catch (err) {
				console.error('Error reading file:', err);
			}
		}
	};

	return (
		<div className='mt-3'>
			<div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
				{/* URLs Section */}
				<div className='bg-white p-3 rounded-md border border-yellow-200'>
					<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2 text-sm'>
						🔗 Reference URLs
					</div>
					{displayUrls.length > 0 && (
						<div className='space-y-2 mb-3 max-h-32 overflow-y-auto'>
							{displayUrls.map((url, idx) => (
								<div
									key={idx}
									className='flex items-center justify-between text-xs bg-gray-50 border rounded p-2'
								>
									<span className='truncate flex-1 text-blue-600'>{url}</span>
									<button
										className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors ml-2'
										onClick={() => {
											const currentUrls = data.referenceUrls || [];
											updateData({
												referenceUrls: currentUrls.filter((_, i) => i !== idx),
											});
										}}
									>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
					<div className='flex gap-2'>
						<input
							type='text'
							value={currentReferenceUrl}
							onChange={(e) => setCurrentReferenceUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && currentReferenceUrl.trim()) {
									handleAddUrl();
								}
							}}
							placeholder='https://example.com/article'
							className='flex-grow px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-yellow-500 focus:border-yellow-500'
						/>
						<button
							onClick={handleAddUrl}
							className='px-4 py-2 text-sm bg-gray-200 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-300'
						>
							Add
						</button>
					</div>
				</div>

				{/* Files Section */}
				<div className='bg-white p-3 rounded-md border border-yellow-200'>
					<div className='font-semibold mb-2 text-gray-800 flex items-center gap-2 text-sm'>
						📄 Upload Files (PDF/DOCX)
					</div>
					{displayFiles.length > 0 && (
						<div className='space-y-2 mb-3 max-h-32 overflow-y-auto'>
							{displayFiles.map((file, idx) => (
								<div
									key={idx}
									className='flex items-center justify-between text-xs bg-gray-50 border rounded p-2'
								>
									<span className='truncate flex-1'>{file.name}</span>
									<button
										className='px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors ml-2'
										onClick={() => {
											const currentFiles = data.referenceFiles || [];
											updateData({
												referenceFiles: currentFiles.filter((_, i) => i !== idx),
											});
										}}
									>
										Remove
									</button>
								</div>
							))}
						</div>
					)}
					<input
						type='file'
						accept='.pdf,.docx'
						onChange={handleFileUpload}
						className='block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-yellow-50 file:text-yellow-700 hover:file:bg-yellow-100 cursor-pointer'
					/>
				</div>
			</div>

			<div className='bg-white/70 p-3 rounded-md border border-yellow-200'>
				<div className='text-sm text-gray-700 mb-2'>
					<strong>Added:</strong> {data.referenceUrls?.length || 0} URL(s),{' '}
					{data.referenceFiles?.length || 0} File(s)
				</div>
				<button
					disabled={completedSelections.has('references')}
					className={`w-full px-4 py-2 text-sm font-semibold text-white rounded-lg shadow-md transition-all ${completedSelections.has('references')
							? 'bg-gray-400 cursor-not-allowed'
							: 'bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 hover:shadow-lg'
						}`}
					onClick={handleContinue}
				>
					Continue (skip)
				</button>
			</div>
		</div>
	);
};

export default ReferencesForm;

