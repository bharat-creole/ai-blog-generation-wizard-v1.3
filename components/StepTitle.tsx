import React, { useState } from 'react';
import { BlogData } from '../types';
import { SparklesIcon, LockClosedIcon } from './icons';
import * as geminiService from '../services/geminiService';

interface Props {
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
}

const StepTitle: React.FC<Props> = ({ data, updateData }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);

    const handleGenerateTitles = async () => {
        if (!data.apiKey) {
            setGenError('Please enter your Gemini API Key to generate titles.');
            return;
        }
        setGenError(null);
        setIsGenerating(true);
        try {
            const titles = await geminiService.generateTitles(data, data.apiKey);
            updateData({ suggestedTitles: titles, title: titles[0] || '' });
        } catch (err) {
            console.error(err);
            setGenError('Failed to generate titles. Check your API Key and try again.');
        } finally {
            setIsGenerating(false);
        }
    };
    
    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Tell us what topic are you targeting?</h2>
            <p className="text-gray-600 mb-8">Define the topic to tailor your content for maximum impact.</p>

            <div className="space-y-6">
                 <div>
                    <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key *</label>
                    <input 
                        type="password" 
                        id="apiKey" 
                        value={data.apiKey} 
                        onChange={e => updateData({ apiKey: e.target.value })} 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
                        placeholder="Enter your API key here"
                    />
                     <p className="text-xs text-gray-500 mt-1">Your API key is stored only in your browser for this session.</p>
                </div>
                <div>
                    <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-1">Topic *</label>
                    <input type="text" id="topic" value={data.topic} onChange={e => updateData({ topic: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500" />
                </div>
                <div>
                    <label htmlFor="targetLocation" className="block text-sm font-medium text-gray-700 mb-1">Target Location *</label>
                    <select id="targetLocation" value={data.targetLocation} onChange={e => updateData({ targetLocation: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 bg-white">
                        <option>United States</option>
                        <option>United Kingdom</option>
                        <option>Canada</option>
                        <option>Australia</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="primaryKeyword" className="block text-sm font-medium text-gray-700 mb-1">Primary keyword *</label>
                    <div className="relative">
                        <input type="text" id="primaryKeyword" value={data.primaryKeyword} onChange={e => updateData({ primaryKeyword: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500" />
                        <button className="absolute inset-y-0 right-0 flex items-center px-3 text-sm text-gray-500 bg-gray-50 border-l border-gray-300 rounded-r-md hover:bg-gray-100">
                            Keywords Explorer <LockClosedIcon className="w-4 h-4 ml-1" />
                        </button>
                    </div>
                </div>
                 <div>
                    <label htmlFor="blogTitle" className="block text-sm font-medium text-gray-700 mb-1">Generate Your Blog Title (or Enter Manually) *</label>
                    <div className="relative">
                        <input type="text" id="blogTitle" placeholder="Example: How Generative AI is helping Healthcare professionals up-skill their talent?" value={data.title} onChange={e => updateData({ title: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500" />
                        <button onClick={handleGenerateTitles} disabled={isGenerating || !data.apiKey} className="absolute inset-y-0 right-0 flex items-center justify-center w-44 text-sm font-semibold text-orange-600 bg-orange-100 border-l border-orange-200 rounded-r-md hover:bg-orange-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                             {isGenerating ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500"></div>
                             ) : <>Generate with AI <SparklesIcon className="w-4 h-4 ml-1" /></>}
                        </button>
                    </div>
                    {genError && <p className="text-red-500 text-xs mt-1">{genError}</p>}
                </div>
                {data.suggestedTitles.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium text-gray-700">Choose a Title</h4>
                        {data.suggestedTitles.map((title, index) => (
                             <div key={index} className="flex items-center">
                                <input id={`title-${index}`} name="suggestedTitle" type="radio" onChange={() => updateData({ title })} checked={data.title === title} className="h-4 w-4 text-orange-600 border-gray-300 focus:ring-orange-500"/>
                                <label htmlFor={`title-${index}`} className="ml-3 block text-sm text-gray-700">{title}</label>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StepTitle;
