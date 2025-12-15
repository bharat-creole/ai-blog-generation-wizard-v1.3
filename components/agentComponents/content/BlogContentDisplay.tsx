import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Spinner from '../../common/Spinner';

/**
 * Props for BlogContentDisplay component
 */
interface BlogContentDisplayProps {
	draft: string;
	viewMode: 'outline' | 'blog' | 'markdown';
	setViewMode: React.Dispatch<
		React.SetStateAction<'outline' | 'blog' | 'markdown'>
	>;
	setDraft: React.Dispatch<React.SetStateAction<string>>;
	isThinking: boolean;
	seoScore: number | null;
	seoPrimary: string;
	seoCritical: string;
	isRanking: boolean;
}

/**
 * Component to display blog content with markdown preview and raw view
 *
 * Features:
 * - Toggle between markdown preview and raw markdown view
 * - Display SEO score and insights
 * - Show loading state while generating
 * - Editable raw markdown textarea
 *
 * @param props - BlogContentDisplayProps containing draft, view mode, SEO data, etc.
 * @returns JSX.Element - Blog content display component
 */
export const BlogContentDisplay: React.FC<BlogContentDisplayProps> = ({
	draft,
	viewMode,
	setViewMode,
	setDraft,
	isThinking,
	seoScore,
	seoPrimary,
	seoCritical,
	isRanking,
}) => {
	return (
		<div className='flex flex-col min-h-0 w-[70%] transition-all duration-700 ease-in-out animate-[slideIn_0.7s_ease-out] border-2 border-orange-300 rounded-xl bg-white p-4 shadow-lg'>
			<div className='flex items-center justify-between mb-2'>
				<div className='flex items-center gap-2'>
					<div  className='flex flex-col gap-[12px]'>

					<h3 className='font-inter text-[28px] font-semibold text-black'>
						Your blog is ready!
					</h3>
					<div className='font-inter text-[14px] font-medium text-[#777777]'>
						define the topic to tailor your content for maximum impact
					</div>
					</div>
					{/* SEO Info Button */}
					{seoScore !== null &&
						(seoPrimary || seoCritical) && (
							<div className='relative group'>
								<button className='w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold hover:bg-blue-200 transition-colors flex items-center justify-center'>
									i
								</button>
								<div className='absolute left-0 top-6 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50'>
									<div className='space-y-3 text-sm'>
										{seoPrimary && (
											<div className='p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg'>
												<div className='flex items-center gap-2 mb-1'>
													<span className='text-base'>
														⭐
													</span>
													<span className='font-bold text-blue-700'>
														Primary
														Ranking
														Factor
													</span>
												</div>
												<p className='text-gray-700 text-xs'>
													{
														seoPrimary
													}
												</p>
											</div>
										)}
										{seoCritical && (
											<div className='p-3 bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-lg'>
												<div className='flex items-center gap-2 mb-1'>
													<span className='text-base'>
														⚠️
													</span>
													<span className='font-bold text-red-700'>
														Most
														Critical
														Flaw
													</span>
												</div>
												<p className='text-gray-700 text-xs'>
													{
														seoCritical
													}
												</p>
											</div>
										)}
									</div>
								</div>
							</div>
						)}
				</div>
				<div className='flex items-center gap-3'>
					{/* View Mode Toggle */}
					{draft.trim() && (
						<div className='flex gap-1 '>
							<button
								onClick={() =>
									setViewMode('markdown')
								}
								className={`font-inter text-[14px] px-[12px] border py-[5.5px] rounded-[10px] font-semibold ${
									viewMode === 'markdown'
										? 'bg-primary text-white'
										: 'bg-offwhite text-[#777777] border-lightgray'
								}`}
							>
								Preview
							</button>
							<button
								onClick={() =>
									setViewMode('blog')
								}
								className={`font-inter text-[14px] px-[12px] border py-[5.5px] rounded-[10px] font-semibold  ${
									viewMode === 'blog'
										? 'bg-primary text-white'
										: 'bg-offwhite text-[#777777] border-lightgray'
								}`}
							>
								Raw
							</button>
						</div>
					)}
					{/* SEO Score */}
					{isRanking ? (
						<div className='flex items-center gap-2 text-gray-500 text-sm bg-white px-4 py-2 rounded-full shadow-md'>
							<Spinner />
							<span className='font-medium'>
								Scoring SEO…
							</span>
						</div>
					) : seoScore !== null ? (
						<div className='flex items-center gap-2 px-4 py-2 rounded-full shadow-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white'>
							<span className='text-lg'>🎯</span>
							<span className='font-bold text-base'>
								SEO: {seoScore}/100
							</span>
						</div>
					) : (
						<div className='text-sm text-gray-400 italic'>
							SEO score unavailable
						</div>
					)}
				</div>
			</div>

			{/* Content Display */}
			{viewMode === 'markdown' ? (
				<div className='flex-1 overflow-y-auto border rounded-md p-4 bg-white prose prose-sm max-w-none markdown-preview'>
					{draft.trim() ? (
						<div className='markdown-content'>
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
							>
								{draft}
							</ReactMarkdown>
						</div>
					) : (
						<div className='flex items-center justify-center h-full text-gray-400'>
							{isThinking ? (
								<div className='flex flex-col items-center gap-3'>
									<Spinner className='w-8 h-8' />
									<p>
										Generating
										content...
									</p>
								</div>
							) : (
								<p>
									Content will appear here
									as the agent writes...
								</p>
							)}
						</div>
					)}
				</div>
			) : (
				<textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					className='flex-1 p-3 border rounded-md focus:ring-orange-500 focus:border-orange-500 font-mono text-sm'
					placeholder='# Your Blog Title\n\nContent will appear here as the agent writes...'
				/>
			)}
		</div>
	);
};
