import React, { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppView, BlogData } from './types';
import AgentMode from './components/AgentMode';
import SidebarHistory from './components/common/SidebarHistory';
import AppHeader from './components/AppHeader';
import { getEnvironmentConfig } from './components/config';
import { BlogGuidelineIcon, BrandVoiceIcon, MyBlogIcon } from './components/icons';
import { useParentData } from './services/useParentData';

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

// Layout component for header + sidebar
const MainLayout: React.FC<{
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  agentDropdownOpen: boolean;
  setAgentDropdownOpen: (v: boolean) => void;
  view: AppView;
  setView: (v: AppView) => void;
  showBlogInfo: boolean;
  setShowBlogInfo: (v: boolean) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  onMyBlogsClick: () => void;
  onBrandVoiceClick: () => void;
  onBlogGuidelinesClick: () => void;
}> = ({
  children,
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  agentDropdownOpen,
  setAgentDropdownOpen,
  view,
  setView,
  showBlogInfo,
  setShowBlogInfo,
  showTrace,
  setShowTrace,
  showSettings,
  setShowSettings,
  onMyBlogsClick,
  onBrandVoiceClick,
  onBlogGuidelinesClick,
}) => (
    <div className='h-screen flex flex-col bg-gradient-to-br from-gray-50 via-orange-50 to-gray-50 font-sans overflow-hidden'>
      <AppHeader />
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
          ${sidebarCollapsed ? 'w-20' : 'w-64'}
          bg-white/80 backdrop-blur-lg border-r border-gray-200/50 shadow-lg flex flex-col
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
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className='hidden lg:flex p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-all ml-auto'
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
                  if (sidebarCollapsed) {
                    setSidebarCollapsed(false);
                    setAgentDropdownOpen(true);
                  } else {
                    setAgentDropdownOpen(!agentDropdownOpen);
                  }
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'px-[8px]'} gap-[10px] font-inter text-[14px] py-[14px] hover:bg-gray-100 rounded-[6px] font-semibold text-[#777777]`}
                title={sidebarCollapsed ? 'Agent Mode' : ''}
              >
                <span className='text-xl flex-shrink-0'>🤖</span>
                {!sidebarCollapsed && (
                  <>
                    <div className='flex-1 text-left'>
                      <div className='font-inter text-[14px] font-medium text-[#777777]'>
                        Agent Mode
                      </div>
                    </div>
                    <svg
                      className={`w-4 h-4 transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`}
                      fill='none'
                      stroke='#777777'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 9l-7 7-7-7'
                      />
                    </svg>
                  </>
                )}
                {sidebarCollapsed && view === AppView.Agent && (
                  <div className='absolute right-1 top-1 w-2 h-2 bg-white rounded-full animate-pulse' />
                )}
              </button>

              {/* Agent Sub-menu */}
              {!sidebarCollapsed &&
                agentDropdownOpen &&
                view === AppView.Agent && (
                  <div className='mt-1 ml-4 space-y-1 border-l border-lightgray '>
                    <button
                      onClick={() => setShowBlogInfo(!showBlogInfo)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${showBlogInfo
                        ? 'bg-orange-100 text-orange-700'
                        : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      <span>
                        {showBlogInfo ? '📂' : '📁'}
                      </span>
                      <span className='flex-1 text-left font-inter text-[14px] font-normal text-black'>
                        {showBlogInfo ? 'Close' : 'Open'} Blog Info
                      </span>
                    </button>
                    <button
                      onClick={() => setShowTrace(!showTrace)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${showTrace
                        ? 'bg-orange-100 text-orange-700'
                        : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      <span>
                        {showTrace ? '🔍' : '👁️'}
                      </span>
                      <span className='flex-1 text-left font-inter text-[14px] font-normal text-black'>
                        {showTrace ? 'Hide' : 'Show'} Trace
                      </span>
                    </button>
                    <button
                      onClick={() => setShowSettings(!showSettings)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${showSettings
                        ? 'bg-orange-100 text-orange-700'
                        : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                      <span>
                        {showSettings ? '⚙️' : '⚙️'}
                      </span>
                      <span className='flex-1 text-left font-inter text-[14px] font-normal text-black'>
                        {showSettings ? 'Close' : 'Open'} Settings
                      </span>
                    </button>
                  </div>
                )}
            </div>

            {/* My Blog, Brand Voice, Blog Guidelines as separate sidebar buttons */}
            <button
              onClick={onMyBlogsClick}
              className={`w-full flex items-center font-inter text-[14px] px-[8px] py-[14px] gap-[10px] hover:bg-gray-100 rounded-[6px] font-semibold text-[#777777] ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? 'My Blog' : ''}
            >
              <span className='text-xl flex-shrink-0'>
                <MyBlogIcon />
              </span>
              {!sidebarCollapsed && <span className='flex-1 text-left'>My Blog</span>}
            </button>
            <button
              onClick={onBrandVoiceClick}
              className={`w-full flex items-center font-inter text-[14px] px-[8px] py-[14px] gap-[10px] hover:bg-gray-100 rounded-[6px] font-semibold text-[#777777] ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? 'Brand Voice' : ''}
            >
              <span className='text-xl flex-shrink-0'>
                <BrandVoiceIcon />
              </span>
              {!sidebarCollapsed && <span className='flex-1 text-left'>Brand Voice</span>}
            </button>
            <button
              onClick={onBlogGuidelinesClick}
              className={`w-full flex items-center font-inter text-[14px] px-[8px] py-[14px] gap-[10px] hover:bg-gray-100 rounded-[6px] font-semibold text-[#777777] ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? 'Blog Guidelines' : ''}
            >
              <BlogGuidelineIcon />
              {!sidebarCollapsed && <span className='flex-1 text-left'>Blog Guidelines</span>}
            </button>
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
        {children}
      </div>
    </div>
  );

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.Agent);
  const [blogData, setBlogData] = useState<BlogData>(initialBlogData);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [showBlogInfo, setShowBlogInfo] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);

  // Listen for data from parent application via postMessage
  console.log("userId", localStorage.getItem('userId'));
  useParentData((data) => {
    console.log('🔄 [App] Received data from parent via postMessage:', data);
    // Data is already stored in localStorage by the hook
    // Optionally update state or trigger other actions here if needed
  });

  useEffect(() => {
    try {
      console.log('🔍 [Auth] Checking URL for token...');
      console.log('   Full URL:', window.location.href);
      console.log('   Search:', window.location.search);
      console.log('   Hash:', window.location.hash);

      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));

      // Check query parameters first, then hash
      const token = urlParams.get('token') || hashParams.get('token');
      const userId = urlParams.get('userId') || hashParams.get('userId');

      console.log('   Token found:', token ? 'Yes' : 'No');
      console.log('   UserId found:', userId ? 'Yes' : 'No');

      if (token) {
        // Store token in localStorage
        localStorage.setItem('accessToken', token);
        console.log('✅ [Auth] Token stored in localStorage as "accessToken"');
        console.log('   Token length:', token.length);

        // Verify it was stored
        const stored = localStorage.getItem('accessToken');
        if (stored === token) {
          console.log('✅ [Auth] Token verification: SUCCESS');
        } else {
          console.error('❌ [Auth] Token verification: FAILED');
        }

        // Also store userId if provided
        if (userId) {
          localStorage.setItem('userId', userId);
          console.log('✅ [Auth] UserId stored:', userId);
        }

        // Clean up URL by removing token and userId from query/hash
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('token');
        newUrl.searchParams.delete('userId');

        // Remove from hash if present
        if (window.location.hash.includes('token') || window.location.hash.includes('userId')) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          hashParams.delete('token');
          hashParams.delete('userId');
          const newHash = hashParams.toString();
          newUrl.hash = newHash ? `#${newHash}` : '';
        }

        // Update URL without reload (clean URL)
        window.history.replaceState({}, '', newUrl.toString());
        console.log('✅ [Auth] URL cleaned, new URL:', newUrl.toString());
      } else {
        // Check if token already exists in localStorage
        const existingToken = localStorage.getItem('accessToken') ||
          localStorage.getItem('token') ||
          localStorage.getItem('authToken');
        if (existingToken) {
          console.log('ℹ️  [Auth] No token in URL, but found existing token in localStorage');
        } else {
          console.warn('⚠️  [Auth] No token found in URL or localStorage');
        }
      }
    } catch (e) {
      console.error('❌ [Auth] Failed to extract token from URL:', e);
    }
  }, []);
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

  // Handle selecting a conversation from history to resume
  const handleSelectThread = useCallback(async (threadId: string) => {
    console.log('📂 [History] Loading thread:', threadId);
    setCurrentThreadId(threadId);

    try {
      // @ts-ignore
      const API_BASE = import.meta.env?.VITE_AGENT_API_BASE || 'http://localhost:3001';
      const token = localStorage.getItem('accessToken');

      const response = await fetch(`${API_BASE}/api/agent/history/${threadId}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        }
      });

      if (response.ok) {
        const { thread } = await response.json();

        // Load the agent state from history
        if (thread.agentState) {
          const state = thread.agentState;

          // Update blog data with the conversation state
          setBlogData({
            ...blogData,
            topic: state.data?.topic || '',
            title: state.data?.title || '',
            primaryKeyword: state.data?.primaryKeyword || '',
            secondaryKeywords: state.data?.secondaryKeywords || [],
            outline: state.outline || [],
            blogContent: state.draft || '',
            targetLocation: state.data?.targetLocation || 'United States',
            referenceUrls: state.data?.referenceUrls || [],
            interlinks: state.data?.interlinks || [],
          });

          console.log('✅ [History] Thread loaded successfully');
          console.log('   Messages count:', thread.messages?.length || 0);
        }
      }
    } catch (error) {
      console.error('❌ [History] Failed to load thread:', error);
    }
  }, [blogData]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <MainLayout
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              sidebarCollapsed={sidebarCollapsed}
              setSidebarCollapsed={setSidebarCollapsed}
              agentDropdownOpen={agentDropdownOpen}
              setAgentDropdownOpen={setAgentDropdownOpen}
              view={view}
              setView={setView}
              showBlogInfo={showBlogInfo}
              setShowBlogInfo={setShowBlogInfo}
              showTrace={showTrace}
              setShowTrace={setShowTrace}
              showSettings={showSettings}
              setShowSettings={setShowSettings}

            >
              <main className='flex-1 overflow-hidden p-6 bg-[#FFFFFF]'>
                <AgentMode
                  data={blogData}
                  updateData={updateData}
                  showBlogInfo={showBlogInfo}
                  showTrace={showTrace}
                  showSettings={showSettings}
                  onCollapseSidebar={() => setSidebarCollapsed(true)}
                  loadedThreadId={currentThreadId}
                />
              </main>
            </MainLayout>
          }
        />
        <Route path="/agent" element={<AgentMode
          data={blogData}
          updateData={updateData}
          showBlogInfo={showBlogInfo}
          showTrace={showTrace}
          showSettings={showSettings}
          onCollapseSidebar={() => setSidebarCollapsed(true)}
          loadedThreadId={currentThreadId}
        />} />

      </Routes>
    </BrowserRouter>
  );
};

export default App;
