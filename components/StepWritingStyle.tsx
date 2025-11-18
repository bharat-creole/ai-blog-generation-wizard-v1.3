import React from 'react';
import { BlogData } from '../types';

interface Props {
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
}

const StepWritingStyle: React.FC<Props> = ({ data, updateData }) => {
    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Writing Style</h2>
            <p className="text-gray-600 mb-8">Choose the right brand voice, persona & style guide as defined under global settings</p>
            
            <div className="space-y-6 max-w-lg">
                <div>
                    <label htmlFor="brandVoice" className="block text-sm font-medium text-gray-700 mb-1">Brand Voice</label>
                    <select id="brandVoice" value={data.brandVoice} onChange={e => updateData({ brandVoice: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 bg-white">
                        <option>Default</option>
                        <option>Professional</option>
                        <option>Casual</option>
                        <option>Witty</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="blogGuideline" className="block text-sm font-medium text-gray-700 mb-1">Blog Guideline</label>
                    <select id="blogGuideline" value={data.blogGuideline} onChange={e => updateData({ blogGuideline: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 bg-white">
                        <option>Default</option>
                        <option>SEO Optimized</option>
                        <option>Technical Deep Dive</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="llmModel" className="block text-sm font-medium text-gray-700 mb-1">LLM model *</label>
                    <select id="llmModel" value={data.llmModel} onChange={e => updateData({ llmModel: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 bg-white">
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                        <option value="gemini-flash-latest">gemini-flash-latest</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-1">Language *</label>
                    <select id="language" value={data.language} onChange={e => updateData({ language: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 bg-white">
                        <option>English</option>
                        <option>Spanish</option>
                        <option>French</option>
                        <option>German</option>
                    </select>
                </div>
            </div>
        </div>
    );
};

export default StepWritingStyle;