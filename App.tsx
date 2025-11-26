import React, { useState, useCallback, useEffect } from 'react';
import { AppView, BlogData } from './types';
import AgentMode from './components/AgentMode';

const initialBlogData: BlogData = {
	apiKey: '',
	title: '',
	topic: '',
	targetLocation: 'United States',
	primaryKeyword: '',
	secondaryKeywords: [],
	suggestedTitles: [],
	referenceUrls: [],
	referenceFiles: [],
	interlinks: [],
	brandVoice: 'Default',
	blogGuideline: 'Default',
	llmModel: 'gemini-2.5-flash',
	language: 'English',
	outline: [],
	blogContent: '',
};

const App: React.FC = () => {
	const [view, setView] = useState<AppView>(AppView.Agent);
	const [blogData, setBlogData] = useState<BlogData>(initialBlogData);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
	const [showBlogInfo, setShowBlogInfo] = useState(false);
	const [showTrace, setShowTrace] = useState(false);
	const [showSettings, setShowSettings] = useState(false);

	// Load state from localStorage on initial render
	useEffect(() => {
		try {
			const savedData = localStorage.getItem('blogData');
			if (savedData) {
				setBlogData(JSON.parse(savedData));
			}
			const savedApiKey = localStorage.getItem('geminiApiKey');
			if (savedApiKey) {
				setBlogData((prev) => ({
					...prev,
					apiKey: savedApiKey,
				}));
			}
		} catch (e) {
			console.error(
				'Failed to parse saved blog data from localStorage',
				e
			);
			localStorage.removeItem('blogData');
			localStorage.removeItem('geminiApiKey');
		}
	}, []);

	// Save state to localStorage whenever it changes
	useEffect(() => {
		try {
			localStorage.setItem('blogData', JSON.stringify(blogData));
			if (blogData.apiKey) {
				localStorage.setItem('geminiApiKey', blogData.apiKey);
			}
		} catch (e) {
			console.error('Failed to save blog data to localStorage', e);
		}
	}, [blogData]);

	const updateData = useCallback((data: Partial<BlogData>) => {
		setBlogData((prev) => ({ ...prev, ...data }));
	}, []);

	const renderView = () => {
		return (
			<AgentMode
				data={blogData}
				updateData={updateData}
				showBlogInfo={showBlogInfo}
				showTrace={showTrace}
				showSettings={showSettings}
				onCollapseSidebar={() => setSidebarCollapsed(true)}
			/>
		);
	};

	return (
		<div className='h-screen flex flex-col bg-gradient-to-br from-gray-50 via-orange-50 to-gray-50 font-sans overflow-hidden'>
			{/* Compact Top Header - Logo Only */}
			<header className='w-full bg-white/80 backdrop-blur-lg border-b border-gray-200/50 shadow-sm'>
				<div className='px-6 py-2.5 flex items-center justify-between'>
					<div className='flex items-center gap-3'>
						<div className='w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-lg'>
							<span className='text-white font-bold text-lg'>
								✍
							</span>
						</div>
						<div>
							<h1 className='text-base font-bold bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent'>
								Bloggr
								<span className='text-orange-600'>
									.AI
								</span>
							</h1>
						</div>
					</div>

					{/* Mobile Menu Button */}
					<button
						onClick={() => setSidebarOpen(!sidebarOpen)}
						className='lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100'
					>
						<svg
							className='w-6 h-6'
							fill='none'
							stroke='currentColor'
							viewBox='0 0 24 24'
						>
							{sidebarOpen ? (
								<path
									strokeLinecap='round'
									strokeLinejoin='round'
									strokeWidth={2}
									d='M6 18L18 6M6 6l12 12'
								/>
							) : (
								<path
									strokeLinecap='round'
									strokeLinejoin='round'
									strokeWidth={2}
									d='M4 6h16M4 12h16M4 18h16'
								/>
							)}
						</svg>
					</button>
				</div>
			</header>

			{/* Main Layout - Sidebar + Content */}
			<div className='flex-1 flex overflow-hidden relative'>
				{/* Overlay for Mobile */}
				{sidebarOpen && (
					<div
						className='fixed inset-0 bg-black/50 z-40 lg:hidden'
						onClick={() => setSidebarOpen(false)}
					/>
				)}

				{/* Left Sidebar - Mode Navigation */}
				<aside
					className={`
					${
						sidebarCollapsed ? 'w-20' : 'w-64'
					} bg-white/80 backdrop-blur-lg border-r border-gray-200/50 shadow-lg flex flex-col
					fixed lg:relative inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out
					${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
					mt-[49px] lg:mt-0
				`}
				>
					<div className='p-4 border-b border-gray-200/50 flex items-center justify-between'>
						{!sidebarCollapsed && (
							<p className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
								Navigation
							</p>
						)}
						{/* Desktop Collapse Toggle */}
						<button
							onClick={() =>
								setSidebarCollapsed(
									!sidebarCollapsed
								)
							}
							className='hidden lg:flex p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-all ml-auto'
							title={
								sidebarCollapsed
									? 'Expand sidebar'
									: 'Collapse sidebar'
							}
						>
							<svg
								className='w-4 h-4'
								fill='none'
								stroke='currentColor'
								viewBox='0 0 24 24'
							>
								{sidebarCollapsed ? (
									<path
										strokeLinecap='round'
										strokeLinejoin='round'
										strokeWidth={2}
										d='M13 5l7 7-7 7M5 5l7 7-7 7'
									/>
								) : (
									<path
										strokeLinecap='round'
										strokeLinejoin='round'
										strokeWidth={2}
										d='M11 19l-7-7 7-7m8 14l-7-7 7-7'
									/>
								)}
							</svg>
						</button>
					</div>

					<nav className='flex-1 p-3 space-y-2'>
						{/* Agent Mode Button with Dropdown */}
						<div>
							<button
								onClick={() => {
									setView(AppView.Agent);
									if (!sidebarCollapsed) {
										setAgentDropdownOpen(
											!agentDropdownOpen
										);
									}
									setSidebarOpen(false);
								}}
								className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 ${
									view === AppView.Agent
										? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30 scale-[1.02]'
										: 'text-gray-700 hover:bg-gray-100 hover:shadow-md'
								} ${
									sidebarCollapsed
										? 'justify-center'
										: ''
								}`}
								title={
									sidebarCollapsed
										? 'Agent Mode'
										: ''
								}
							>
								<span className='text-xl flex-shrink-0'>
									🤖
								</span>
								{!sidebarCollapsed && (
									<>
										<div className='flex-1 text-left'>
											<div className='font-semibold text-sm'>
												Agent
												Mode
											</div>
											<div
												className={`text-xs ${
													view ===
													AppView.Agent
														? 'text-orange-100'
														: 'text-gray-500'
												}`}
											>
												AI-powered
												chat
											</div>
										</div>
										<svg
											className={`w-4 h-4 transition-transform ${
												agentDropdownOpen
													? 'rotate-180'
													: ''
											}`}
											fill='none'
											stroke='currentColor'
											viewBox='0 0 24 24'
										>
											<path
												strokeLinecap='round'
												strokeLinejoin='round'
												strokeWidth={
													2
												}
												d='M19 9l-7 7-7-7'
											/>
										</svg>
									</>
								)}
								{sidebarCollapsed &&
									view ===
										AppView.Agent && (
										<div className='absolute right-1 top-1 w-2 h-2 bg-white rounded-full animate-pulse' />
									)}
							</button>

							{/* Agent Sub-menu */}
							{!sidebarCollapsed &&
								agentDropdownOpen &&
								view === AppView.Agent && (
									<div className='mt-1 ml-4 space-y-1'>
										<button
											onClick={() =>
												setShowBlogInfo(
													!showBlogInfo
												)
											}
											className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
												showBlogInfo
													? 'bg-orange-100 text-orange-700'
													: 'text-gray-600 hover:bg-gray-100'
											}`}
										>
											<span>
												{showBlogInfo
													? '📂'
													: '📁'}
											</span>
											<span className='flex-1 text-left'>
												{showBlogInfo
													? 'Close'
													: 'Open'}{' '}
												Blog
												Info
											</span>
										</button>
										<button
											onClick={() =>
												setShowTrace(
													!showTrace
												)
											}
											className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
												showTrace
													? 'bg-orange-100 text-orange-700'
													: 'text-gray-600 hover:bg-gray-100'
											}`}
										>
											<span>
												{showTrace
													? '🔍'
													: '👁️'}
											</span>
											<span className='flex-1 text-left'>
												{showTrace
													? 'Hide'
													: 'Show'}{' '}
												Trace
											</span>
										</button>
										<button
											onClick={() =>
												setShowSettings(
													!showSettings
												)
											}
											className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
												showSettings
													? 'bg-orange-100 text-orange-700'
													: 'text-gray-600 hover:bg-gray-100'
											}`}
										>
											<span>
												{showSettings
													? '⚙️'
													: '⚙️'}
											</span>
											<span className='flex-1 text-left'>
												{showSettings
													? 'Close'
													: 'Open'}{' '}
												Settings
											</span>
										</button>
									</div>
								)}
						</div>
					</nav>

					{/* Sidebar Footer */}
					{!sidebarCollapsed && (
						<div className='p-4 border-t border-gray-200/50'>
							<div className='text-xs text-gray-500 text-center'>
								<p className='font-medium'>
									v1.3
								</p>
								<p className='mt-1'>
									SEO-Optimized Content
								</p>
							</div>
						</div>
					)}
				</aside>

				{/* Main Content Area */}
				<main className='flex-1 overflow-hidden p-6'>
					{renderView()}
				</main>
			</div>
		</div>
	);
};

export default App;
