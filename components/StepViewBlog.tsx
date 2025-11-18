
import React from 'react';
import Spinner from './common/Spinner';
import { ArrowUturnLeftIcon } from './icons';

interface Props {
    blogContent: string;
    onRegenerate: () => void;
    isLoading: boolean;
}

const parseMarkdown = (markdown: string): string => {
    return markdown
        .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold my-4">$1</h1>')
        .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold my-3">$1</h2>')
        .replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold my-2">$1</h3>')
        .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*)\*/g, '<em>$1</em>')
        .replace(/^\* (.*$)/gim, '<li class="ml-6 list-disc">$1</li>')
        .replace(/\n/g, '<br />');
};

const StepViewBlog: React.FC<Props> = ({ blogContent, onRegenerate, isLoading }) => {
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Spinner />
                <p className="mt-4 text-gray-600">Generating your blog...</p>
                <p className="text-sm text-gray-500">The final content is being written.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <span className="px-3 py-1 text-sm font-semibold text-blue-800 bg-blue-100 rounded-full">Version 1</span>
                <div>
                     <button onClick={onRegenerate} className="flex items-center px-3 py-1.5 text-sm font-semibold text-green-700 bg-green-100 rounded-md hover:bg-green-200 mr-2">
                        <ArrowUturnLeftIcon className="w-4 h-4 mr-2" />
                        Re-Generate Blog
                    </button>
                </div>
            </div>

            <h2 className="text-2xl font-bold text-gray-800 mb-2">Your blog!</h2>
            <p className="text-gray-600 mb-8">Define the topic to tailor your content for maximum impact</p>

            <div
                className="prose max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: parseMarkdown(blogContent) }}
            />
        </div>
    );
};

export default StepViewBlog;
