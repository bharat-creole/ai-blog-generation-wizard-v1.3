import React, { useState, useCallback, useEffect } from 'react';
import { AppStep, AppView, BlogData } from './types';
import Stepper from './components/Stepper';
import StepTitle from './components/StepTitle';
import StepReferences from './components/StepReferences';
import StepInterlinking from './components/StepInterlinking';
import StepWritingStyle from './components/StepWritingStyle';
import StepReviewOutline from './components/StepReviewOutline';
import StepViewBlog from './components/StepViewBlog';
import BlogRanker from './components/BlogRanker';
import AgentMode from './components/AgentMode';
import { STEPS } from './constants';
import * as geminiService from './services/geminiService';
import { invokeOutline, invokeBlog } from './services/langgraph/blogGraph';

const initialBlogData: BlogData = {
    apiKey: '',
    title: '',
    topic: 'AWS databases',
    targetLocation: 'United States',
    primaryKeyword: 'database offerings by AWS',
    secondaryKeywords: [],
    suggestedTitles: [],
    referenceUrls: [],
    referenceFiles: [],
    interlinks: [],
    brandVoice: 'Default',
    blogGuideline: 'Default',
    llmModel: 'gemini-flash-latest',
    language: 'English',
    outline: [],
    blogContent: '',
};

const App: React.FC = () => {
    const [view, setView] = useState<AppView>(AppView.Wizard);
    const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.Title);
    const [blogData, setBlogData] = useState<BlogData>(initialBlogData);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load state from localStorage on initial render
    useEffect(() => {
        try {
            const savedData = localStorage.getItem('blogData');
            if (savedData) {
                setBlogData(JSON.parse(savedData));
            }
             const savedApiKey = localStorage.getItem('geminiApiKey');
             if (savedApiKey) {
                setBlogData(prev => ({...prev, apiKey: savedApiKey}));
             }
        } catch (e) {
            console.error("Failed to parse saved blog data from localStorage", e);
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
        } catch(e) {
            console.error("Failed to save blog data to localStorage", e);
        }
    }, [blogData]);


    const updateData = useCallback((data: Partial<BlogData>) => {
        setBlogData(prev => ({ ...prev, ...data }));
    }, []);

    const handleNext = async () => {
        setError(null);
        const currentIndex = STEPS.findIndex(step => step.id === currentStep);
        if (currentIndex < STEPS.length - 1) {
            const nextStep = STEPS[currentIndex + 1].id;
            
            if (nextStep === AppStep.ReviewOutline && blogData.outline.length === 0) {
                if (!blogData.apiKey) {
                    setError('Please enter your Gemini API Key on the first step to proceed.');
                    setCurrentStep(AppStep.Title);
                    return;
                }
                await generateOutline();
            } else if (nextStep === AppStep.YourBlogIsReady && !blogData.blogContent) {
                if (!blogData.apiKey) {
                    setError('Please enter your Gemini API Key on the first step to proceed.');
                    setCurrentStep(AppStep.Title);
                    return;
                }
                await generateBlog();
            } else {
                 setCurrentStep(nextStep);
            }
        }
    };
    
    const handleBack = () => {
        setError(null);
        const currentIndex = STEPS.findIndex(step => step.id === currentStep);
        if (currentIndex > 0) {
            setCurrentStep(STEPS[currentIndex - 1].id);
        }
    };

    const generateOutline = async (feedback?: string) => {
        if (!blogData.apiKey) {
            setError('Please enter your Gemini API Key on the first step.');
            setCurrentStep(AppStep.Title);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const { outline, data } = await invokeOutline(blogData, feedback);
            updateData({ ...data, outline });
            setCurrentStep(AppStep.ReviewOutline);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Failed to generate outline. Please check your API key and try again. Error: ${errorMessage}`);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };
    
    const generateBlog = async () => {
         if (!blogData.apiKey) {
            setError('Please enter your Gemini API Key on the first step.');
            setCurrentStep(AppStep.Title);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const { content, data } = await invokeBlog(blogData);
            updateData({ ...data, blogContent: content });
            setCurrentStep(AppStep.YourBlogIsReady);
        } catch (err) {
            setError('Failed to generate blog content. Please try again.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const renderWizardStep = () => {
        switch (currentStep) {
            case AppStep.Title:
                return <StepTitle data={blogData} updateData={updateData} />;
            case AppStep.ReferenceArticles:
                return <StepReferences data={blogData} updateData={updateData} />;
            case AppStep.Interlinking:
                return <StepInterlinking data={blogData} updateData={updateData} />;
            case AppStep.WritingStyle:
                return <StepWritingStyle data={blogData} updateData={updateData} />;
            case AppStep.ReviewOutline:
                return <StepReviewOutline data={blogData} updateData={updateData} onRegenerate={generateOutline} isLoading={isLoading} />;
            case AppStep.YourBlogIsReady:
                return <StepViewBlog blogContent={blogData.blogContent} onRegenerate={generateBlog} isLoading={isLoading} />;
            default:
                return null;
        }
    };

    const renderView = () => {
        if (view === AppView.Ranker) {
            return <BlogRanker apiKey={blogData.apiKey} savedBlogContent={blogData.blogContent} />;
        }
        if (view === AppView.Agent) {
            return (
                <AgentMode
                    data={blogData}
                    updateData={updateData}
                />
            );
        }

        return (
            <div className="w-full max-w-7xl mx-auto bg-white rounded-lg shadow-2xl flex flex-col md:flex-row">
                <Stepper currentStep={currentStep} blogData={blogData} />
                <div className="flex-1 p-6 sm:p-10 flex flex-col">
                    <div className="flex-grow">
                      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}
                      {renderWizardStep()}
                    </div>
                    <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
                        <div>
                            {currentStep !== AppStep.Title && (
                                <button
                                    onClick={handleBack}
                                    className="px-6 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                                >
                                    BACK
                                </button>
                            )}
                        </div>
                        <div>
                            {currentStep === AppStep.ReviewOutline ? (
                                <button
                                    onClick={handleNext}
                                    disabled={isLoading}
                                    className="px-6 py-2 text-sm font-semibold text-white bg-orange-500 rounded-md hover:bg-orange-600 transition-colors disabled:bg-orange-300"
                                >
                                    {isLoading ? 'Generating Blog...' : 'Generate Blog!'}
                                </button>
                            ) : currentStep === AppStep.YourBlogIsReady ? (
                                <button
                                    onClick={() => alert('Blog generation process completed!')}
                                    className="px-6 py-2 text-sm font-semibold text-white bg-orange-500 rounded-md hover:bg-orange-600 transition-colors"
                                >
                                    DONE
                                </button>
                            ) : (
                                <button
                                    onClick={handleNext}
                                    disabled={isLoading}
                                    className="px-6 py-2 text-sm font-semibold text-white bg-orange-500 rounded-md hover:bg-orange-600 transition-colors disabled:bg-orange-300"
                                >
                                    {isLoading ? 'Loading...' : 'NEXT'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
             <header className="w-full max-w-7xl mx-auto mb-4">
                <div className="flex items-center bg-white p-2 rounded-lg shadow-md">
                    <button 
                        onClick={() => setView(AppView.Wizard)}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${view === AppView.Wizard ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Blog Generation Wizard
                    </button>
                    <button 
                        onClick={() => setView(AppView.Ranker)}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${view === AppView.Ranker ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Blog SEO Ranker
                    </button>
                    <button 
                        onClick={() => setView(AppView.Agent)}
                        className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${view === AppView.Agent ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Agent Mode
                    </button>
                </div>
            </header>
            <main className="w-full">
                {renderView()}
            </main>
        </div>
    );
};

export default App;