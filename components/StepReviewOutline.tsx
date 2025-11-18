
import React, { useState } from 'react';
import { BlogData, OutlineSection } from '../types';
import Spinner from './common/Spinner';
import { TrashIcon, PlusCircleIcon, ArrowUturnLeftIcon } from './icons';

interface Props {
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
    onRegenerate: (feedback?: string) => void;
    isLoading: boolean;
}

const RegenerateModal: React.FC<{
    onClose: () => void;
    onGenerate: (feedback: string) => void;
}> = ({ onClose, onGenerate }) => {
    const [feedback, setFeedback] = useState('');

    const handleGenerate = () => {
        onGenerate(feedback);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">Generate Outline with AI</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
                <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Enter your feedback prompt here..."
                    className="w-full h-32 p-2 border border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
                ></textarea>
                <div className="mt-4 flex justify-end">
                    <button onClick={handleGenerate} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">
                        Generate Outline
                    </button>
                </div>
            </div>
        </div>
    );
};


const StepReviewOutline: React.FC<Props> = ({ data, updateData, onRegenerate, isLoading }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleH2Change = (sectionId: string, value: string) => {
        const newOutline = data.outline.map(section =>
            section.id === sectionId ? { ...section, name: value } : section
        );
        updateData({ outline: newOutline });
    };

    const handleH3Change = (sectionId: string, itemId: string, value: string) => {
        const newOutline = data.outline.map(section => {
            if (section.id === sectionId) {
                return {
                    ...section,
                    items: section.items.map(item =>
                        item.id === itemId ? { ...item, name: value } : item
                    ),
                };
            }
            return section;
        });
        updateData({ outline: newOutline });
    };

    const removeH2 = (sectionId: string) => {
        updateData({ outline: data.outline.filter(s => s.id !== sectionId) });
    };
    
    const removeH3 = (sectionId: string, itemId: string) => {
         const newOutline = data.outline.map(section => {
            if (section.id === sectionId) {
                return { ...section, items: section.items.filter(item => item.id !== itemId) };
            }
            return section;
        });
        updateData({ outline: newOutline });
    };
    
    const addH3 = (sectionId: string) => {
         const newOutline = data.outline.map(section => {
            if (section.id === sectionId) {
                const newId = `${sectionId}-${Date.now()}`;
                return { ...section, items: [...section.items, { id: newId, name: 'New Subheading' }] };
            }
            return section;
        });
        updateData({ outline: newOutline });
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Spinner />
                <p className="mt-4 text-gray-600">Generating your blog outline with AI...</p>
                <p className="text-sm text-gray-500">This may take a moment.</p>
            </div>
        );
    }
    
    return (
        <div>
            {isModalOpen && <RegenerateModal onClose={() => setIsModalOpen(false)} onGenerate={onRegenerate} />}
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Tell Us What Topic Are You Targeting?</h2>
            <p className="text-gray-600 mb-8">Define the topic to tailor your content for maximum impact</p>

            <div className="space-y-6">
                <label className="block text-sm font-medium text-gray-700">Outline *</label>
                {data.outline.map((section, sIdx) => (
                    <div key={`h2-${sIdx}-${section.id}`} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <span className="text-sm font-semibold text-gray-500">H2</span>
                            <input
                                type="text"
                                value={section.name}
                                onChange={(e) => handleH2Change(section.id, e.target.value)}
                                className="flex-grow font-semibold text-gray-800 border-b-2 border-transparent focus:border-orange-500 focus:outline-none"
                            />
                            <button onClick={() => removeH2(section.id)} className="text-gray-400 hover:text-red-500">
                                <TrashIcon className="w-4 h-4"/>
                            </button>
                        </div>
                        <div className="pl-6 mt-4 space-y-3">
                            {section.items.map((item, iIdx) => (
                                <div key={`h3-${section.id}-${iIdx}-${item.id}`} className="flex items-center space-x-2">
                                    <span className="text-sm font-semibold text-gray-400">H3</span>
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(e) => handleH3Change(section.id, item.id, e.target.value)}
                                        className="flex-grow text-gray-700 border-b border-transparent focus:border-orange-500 focus:outline-none"
                                    />
                                     <button onClick={() => removeH3(section.id, item.id)} className="text-gray-400 hover:text-red-500">
                                        <TrashIcon className="w-4 h-4"/>
                                    </button>
                                </div>
                            ))}
                             <button onClick={() => addH3(section.id)} className="flex items-center text-sm text-orange-600 hover:text-orange-800">
                                <PlusCircleIcon className="w-4 h-4 mr-1"/>
                                Add new H3 title
                            </button>
                        </div>
                    </div>
                ))}
            </div>
             <div className="mt-6">
                <button onClick={() => setIsModalOpen(true)} className="flex items-center px-4 py-2 text-sm font-semibold text-green-700 bg-green-100 rounded-md hover:bg-green-200">
                    <ArrowUturnLeftIcon className="w-4 h-4 mr-2" />
                    Re-Generate Outline
                </button>
            </div>
        </div>
    );
};

export default StepReviewOutline;
