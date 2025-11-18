
import React, { useState, useRef } from 'react';
import { BlogData, ReferenceFile } from '../types';
import { LinkIcon, DocumentArrowUpIcon, XCircleIcon, PlusIcon } from './icons';
import { extractHeadingsFromPDF, extractHeadingsFromDOCX, extractHeadingsFromTXT } from '../services/headingExtraction';

interface Props {
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
}

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // remove "data:mime/type;base64," prefix
            resolve(result.split(',')[1]);
        };
        reader.onerror = error => reject(error);
    });
};

const StepReferences: React.FC<Props> = ({ data, updateData }) => {
    const [urlInput, setUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [headingsPreview, setHeadingsPreview] = useState<Record<string, string[]>>({});

    const handleAddUrl = () => {
        if (urlInput.trim() && !data.referenceUrls.includes(urlInput.trim())) {
            updateData({ referenceUrls: [...data.referenceUrls, urlInput.trim()] });
            setUrlInput('');
        }
    };
    
    const removeUrl = (urlToRemove: string) => {
        updateData({ referenceUrls: data.referenceUrls.filter(url => url !== urlToRemove) });
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            const file = event.target.files[0];
            const base64 = await fileToBase64(file);
            const newFile: ReferenceFile = {
                name: file.name,
                mimeType: file.type,
                base64: base64,
            };
            updateData({ referenceFiles: [...data.referenceFiles, newFile] });

            try {
                let headings: string[] = [];
                if (newFile.mimeType === 'application/pdf' || newFile.name.toLowerCase().endsWith('.pdf')) {
                    const r = await extractHeadingsFromPDF(newFile);
                    headings = r.headings;
                } else if (newFile.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || newFile.name.toLowerCase().endsWith('.docx')) {
                    const r = await extractHeadingsFromDOCX(newFile);
                    headings = r.headings;
                } else if (newFile.mimeType === 'text/plain' || newFile.name.toLowerCase().endsWith('.txt')) {
                    const r = await extractHeadingsFromTXT(newFile);
                    headings = r.headings;
                }
                setHeadingsPreview(prev => ({ ...prev, [newFile.name]: headings }));
            } catch (e) {
                setHeadingsPreview(prev => ({ ...prev, [newFile.name]: [] }));
                console.error('Failed to extract headings for', newFile.name, e);
            }
        }
    };
    
    const triggerFileSelect = () => {
        fileInputRef.current?.click();
    };

    const removeFile = (fileName: string) => {
        updateData({ referenceFiles: data.referenceFiles.filter(file => file.name !== fileName) });
        setHeadingsPreview(prev => {
            const next = { ...prev };
            delete next[fileName];
            return next;
        });
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Share your reference data</h2>
            <p className="text-gray-600 mb-8">Share the most relevant and useful content for your blog. It can be a research paper PDF or a useful external link.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* External URLs */}
                <div>
                    <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
                        <LinkIcon className="w-4 h-4 mr-2" /> Reference External URLs *
                    </label>
                    <div className="flex">
                        <input
                            type="text"
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handleAddUrl()}
                            placeholder="Add links here"
                            className="flex-grow px-3 py-2 border border-gray-300 rounded-l-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
                        />
                        <button onClick={handleAddUrl} className="px-4 py-2 bg-gray-200 text-gray-700 border border-l-0 border-gray-300 rounded-r-md hover:bg-gray-300">
                            <PlusIcon className="w-5 h-5"/>
                        </button>
                    </div>
                     <div className="mt-4 space-y-2">
                        {data.referenceUrls.map((url, index) => (
                            <div key={index} className="flex items-center justify-between bg-gray-100 p-2 rounded-md">
                                <span className="text-sm text-gray-700 truncate">{url}</span>
                                <button onClick={() => removeUrl(url)} className="text-gray-400 hover:text-red-500">
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* File Uploads */}
                <div>
                    <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
                        <DocumentArrowUpIcon className="w-4 h-4 mr-2" /> Reference Files *
                    </label>
                    <div onClick={triggerFileSelect} className="flex justify-between items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm cursor-pointer hover:bg-gray-50">
                        <span className="text-gray-500">Upload Files from computer</span>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf,.doc,.docx,.txt" />
                        <button className="p-1 bg-gray-200 text-gray-700 rounded-full hover:bg-gray-300">
                             <PlusIcon className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="mt-4 space-y-2">
                        {data.referenceFiles.map((file, index) => (
                             <div key={index} className="bg-gray-100 p-2 rounded-md">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                                    <button onClick={() => removeFile(file.name)} className="text-gray-400 hover:text-red-500">
                                        <XCircleIcon className="w-5 h-5" />
                                    </button>
                                </div>
                                {headingsPreview[file.name] && (
                                    <div className="mt-2 bg-white border border-gray-200 rounded p-2">
                                        <div className="text-xs font-semibold text-gray-600 mb-1">Extracted Headings ({headingsPreview[file.name].length})</div>
                                        {headingsPreview[file.name].length === 0 ? (
                                            <div className="text-xs text-gray-500">No headings detected</div>
                                        ) : (
                                            <ul className="list-disc pl-5 space-y-1 max-h-40 overflow-auto">
                                                {headingsPreview[file.name].map((h, i) => (
                                                    <li key={`h-${file.name}-${i}`} className="text-xs text-gray-700">{h}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StepReferences;
