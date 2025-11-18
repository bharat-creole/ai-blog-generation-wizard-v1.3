import React, { useState } from 'react';
import { SeoReport } from '../types';
import * as geminiService from '../services/geminiService';
import Spinner from './common/Spinner';

interface Props {
    apiKey: string;
    savedBlogContent: string;
}

type InputSource = 'paste' | 'saved';

const BlogRanker: React.FC<Props> = ({ apiKey, savedBlogContent }) => {
    const [inputSource, setInputSource] = useState<InputSource>('paste');
    const [blogContent, setBlogContent] = useState('');
    const [keyword, setKeyword] = useState('');
    const [report, setReport] = useState<SeoReport | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleRankBlog = async () => {
        if (!apiKey) {
            setError('Gemini API Key is missing. Please set it in the Blog Generation Wizard.');
            return;
        }
        if (!keyword.trim()) {
            setError('Target Keyword is required.');
            return;
        }
        const contentToRank = inputSource === 'saved' ? savedBlogContent : blogContent;
        if (!contentToRank.trim()) {
            setError('Blog content is empty.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setReport(null);

        try {
            // Using gemini-flash-latest for consistency across the app
            const result = await geminiService.rankBlogPost(contentToRank, keyword, apiKey, 'gemini-flash-latest');
            setReport(result);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during ranking.';
            setError(errorMessage);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };
    
    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600 bg-green-100';
        if (score >= 50) return 'text-yellow-600 bg-yellow-100';
        return 'text-red-600 bg-red-100';
    }

    return (
        <div className="w-full max-w-7xl mx-auto bg-white rounded-lg shadow-2xl p-6 sm:p-10">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Blog SEO Ranker</h1>
            <p className="text-gray-600 mb-8">Analyze your blog content against a target keyword to get a comprehensive SEO score and actionable insights.</p>
            
            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Input Section */}
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Keyword *</label>
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            placeholder="e.g., 'data engineering best practices'"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
                        />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Blog Content Source</label>
                         <div className="flex rounded-md shadow-sm">
                            <button onClick={() => setInputSource('paste')} className={`px-4 py-2 border border-gray-300 text-sm font-medium rounded-l-md ${inputSource === 'paste' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                Paste Content
                            </button>
                            <button onClick={() => setInputSource('saved')} className={`px-4 py-2 border-t border-b border-r border-gray-300 text-sm font-medium rounded-r-md ${inputSource === 'saved' ? 'bg-orange-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                Use Saved Blog
                            </button>
                        </div>
                    </div>
                    {inputSource === 'paste' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Paste your blog content here</label>
                            <textarea
                                value={blogContent}
                                onChange={(e) => setBlogContent(e.target.value)}
                                rows={15}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
                                placeholder="Paste the full text of your blog post..."
                            />
                        </div>
                    )}
                     {inputSource === 'saved' && (
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
                           <h4 className="font-semibold text-gray-800">Using Saved Blog</h4>
                           <p className="text-sm text-gray-600 mt-1">
                            {savedBlogContent ? `Loaded content from your currently saved blog post (approx. ${savedBlogContent.split(' ').length} words).` : 'No saved blog content found. Please generate a blog in the wizard first.'}
                           </p>
                        </div>
                    )}
                    <button
                        onClick={handleRankBlog}
                        disabled={isLoading}
                        className="w-full px-6 py-3 text-base font-semibold text-white bg-orange-500 rounded-md hover:bg-orange-600 transition-colors disabled:bg-orange-300"
                    >
                        {isLoading ? 'Analyzing...' : 'Rank Blog'}
                    </button>
                </div>

                {/* Report Section */}
                <div className="relative">
                     {isLoading && (
                        <div className="absolute inset-0 bg-white bg-opacity-80 flex flex-col items-center justify-center rounded-lg z-10">
                            <Spinner />
                            <p className="mt-4 text-gray-600">Performing deep SEO analysis...</p>
                        </div>
                    )}
                    {report ? (
                         <div className="space-y-6">
                            <div className="text-center p-6 bg-gray-50 rounded-lg border">
                                <p className="text-sm font-medium text-gray-500">FINAL SEO SCORE</p>
                                <p className={`text-6xl font-bold ${getScoreColor(report.finalSeoScore).split(' ')[0]}`}>{report.finalSeoScore}<span className="text-3xl text-gray-400">/100</span></p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                               <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                                    <p className="text-xs font-semibold text-blue-800 uppercase">Primary Ranking Factor</p>
                                    <p className="text-base font-medium text-blue-900">{report.primaryRankingFactor}</p>
                               </div>
                               <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                                    <p className="text-xs font-semibold text-red-800 uppercase">Most Critical Flaw</p>
                                    <p className="text-base font-medium text-red-900">{report.mostCriticalFlaw}</p>
                               </div>
                            </div>

                            <h3 className="text-xl font-bold text-gray-800 pt-4 border-t">Detailed Report & Recommendations</h3>
                            <div className="space-y-4">
                                {report.detailedReport.map(pillar => (
                                    <details key={pillar.pillar} className="p-4 border rounded-lg bg-white" open>
                                        <summary className="font-bold text-lg cursor-pointer flex justify-between items-center">
                                            <span>{pillar.pillar}</span>
                                            <span className={`px-3 py-1 text-sm font-bold rounded-full ${getScoreColor(pillar.score * 100 / (pillar.pillar.includes('Content') ? 40 : pillar.pillar.includes('Off-Page') ? 30 : pillar.pillar.includes('On-Page') ? 20 : 10))}`}>{pillar.score} / {pillar.pillar.includes('Content') ? 40 : pillar.pillar.includes('Off-Page') ? 30 : pillar.pillar.includes('On-Page') ? 20 : 10}</span>
                                        </summary>
                                        <div className="mt-4">
                                            <p className="text-sm text-gray-600 mb-2"><span className="font-semibold">Justification:</span> {pillar.justification}</p>
                                            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                                                 <p className="text-sm text-green-800"><span className="font-semibold">Recommended Action:</span> {pillar.recommendedAction}</p>
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                {pillar.subFactors.map(sf => (
                                                    <div key={sf.name} className="text-xs p-2 bg-gray-50 rounded">
                                                        <p className="font-semibold">{sf.name} - Score: {sf.score}</p>
                                                        <p className="text-gray-500">{sf.justification}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </details>
                                ))}
                            </div>
                         </div>
                    ) : (
                        <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg border-2 border-dashed">
                            <p className="text-gray-500">Your SEO report will appear here.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BlogRanker;
