
import React, { useState } from 'react';
import { BlogData, Interlink } from '../types';
import { LinkIcon, XCircleIcon, PlusIcon } from './icons';

interface Props {
    data: BlogData;
    updateData: (data: Partial<BlogData>) => void;
}

const StepInterlinking: React.FC<Props> = ({ data, updateData }) => {
    const [keyword, setKeyword] = useState('');
    const [url, setUrl] = useState('');

    const handleAddLink = () => {
        if (keyword.trim() && url.trim()) {
            const newLink: Interlink = {
                id: Date.now().toString(),
                keyword: keyword.trim(),
                url: url.trim()
            };
            updateData({ interlinks: [...data.interlinks, newLink] });
            setKeyword('');
            setUrl('');
        }
    };
    
    const removeLink = (id: string) => {
        updateData({ interlinks: data.interlinks.filter(link => link.id !== id) });
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Interlinking (upto 5 links)</h2>
            <p className="text-gray-600 mb-8">Add links that you wish to interlink in this blog. A good practice is interlink related articles to boost the customer experience</p>

            <div>
                <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
                    <LinkIcon className="w-4 h-4 mr-2" /> Set Internal URLs *
                </label>
                <div className="flex space-x-2">
                    <input
                        type="text"
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        placeholder="Keyword"
                        className="w-1/3 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
                    />
                    <input
                        type="text"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="Add links here"
                        className="flex-grow px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
                    />
                    <button onClick={handleAddLink} className="px-4 py-2 bg-gray-200 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-300">
                        <PlusIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="mt-6 space-y-3">
                {data.interlinks.map(link => (
                    <div key={link.id} className="flex items-start justify-between bg-gray-50 p-3 rounded-md border border-gray-200">
                        <div>
                            <p className="text-sm font-semibold text-gray-800">{link.keyword}</p>
                            <p className="text-xs text-blue-600">{link.url}</p>
                        </div>
                        <button onClick={() => removeLink(link.id)} className="text-gray-400 hover:text-red-500 mt-1">
                            <XCircleIcon className="w-5 h-5" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default StepInterlinking;
