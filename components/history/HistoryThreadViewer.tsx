import React, { useEffect, useState } from 'react';
import { getAuthHeaders } from '../../services/authUtils';
import { HistoryMessage } from './HistoryMessage';

interface Props {
    threadId: string;
}

const API_BASE = (import.meta as any).env?.VITE_AGENT_API_BASE || 'http://localhost:3001';

export const HistoryThreadViewer: React.FC<Props> = ({ threadId }) => {
    const [thread, setThread] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchThread();
    }, [threadId]);

    const fetchThread = async () => {
        try {
            const response = await fetch(
                `${API_BASE}/api/agent/history/${threadId}`,
                { headers: getAuthHeaders() }
            );

            if (!response.ok) {
                throw new Error('Failed to fetch thread');
            }

            const data = await response.json();
            setThread(data.thread);
        } catch (error: any) {
            console.error('Failed to fetch thread:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-gray-600">Loading conversation...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    Error: {error}
                </div>
            </div>
        );
    }

    if (!thread) {
        return (
            <div className="p-6 text-center">
                <p className="text-gray-600">Thread not found</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            {/* Header */}
            <div className="mb-6 pb-4 border-b">
                <button
                    onClick={() => window.history.back()}
                    className="text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-2"
                >
                    ← Back to History
                </button>

                <h1 className="text-3xl font-bold text-gray-800 mb-4">{thread.title}</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
                    {/* First Message */}
                    {thread.messages && thread.messages.length > 0 && (
                        <div className="col-span-1 md:col-span-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                First Message
                            </p>
                            <p className="text-gray-800 text-sm">
                                {thread.messages.find((m: any) => m.role === 'user')?.content || 'No user message found'}
                            </p>
                        </div>
                    )}

                    {/* Primary Keyword */}
                    {thread.agentState?.data?.primaryKeyword && (
                        <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Primary Keyword
                            </p>
                            <p className="text-gray-800 font-medium">
                                {thread.agentState.data.primaryKeyword}
                            </p>
                        </div>
                    )}

                    {/* Secondary Keyword */}
                    {thread.agentState?.data?.secondaryKeywords && thread.agentState.data.secondaryKeywords.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Secondary Keyword
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {thread.agentState.data.secondaryKeywords.map((kw: any, idx: number) => (
                                    <span key={idx} className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded">
                                        {typeof kw === 'string' ? kw : kw.text}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Topic */}
                    {thread.topic && (
                        <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Topic
                            </p>
                            <p className="text-gray-800">
                                {thread.topic}
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
                    <span>{thread.messageCount} messages</span>
                    <span>{new Date(thread.createdAt).toLocaleDateString()}</span>
                    {thread.blogGenerated && (
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                            ✅ Blog Generated
                        </span>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div className="space-y-4 mb-8">
                {(() => {
                    // Merge messages and toolOutputs
                    const messages = thread.messages || [];
                    const toolOutputs = thread.agentState?.toolOutputs || [];

                    const combined = [
                        ...messages.map((msg: any) => ({ ...msg, timestamp: msg.timestamp || 0 })),
                        ...toolOutputs.map((output: any) => {
                            let uiComponent = '';
                            let uiData = output.data;

                            switch (output.type) {
                                case 'keyword_options':
                                    if (output.data?.type === 'primary') {
                                        uiComponent = 'PrimaryKeywordSelection';
                                    } else if (output.data?.type === 'secondary') {
                                        uiComponent = 'SecondaryKeywordSelection';
                                        // Ensure selectedSecondaries is present for the component
                                        uiData = {
                                            ...output.data,
                                            selectedSecondaries: thread.agentState?.data?.secondaryKeywords || []
                                        };
                                    }
                                    break;
                                case 'title_options':
                                    uiComponent = 'TitleSelection';
                                    break;
                                case 'outline_generated':
                                    uiComponent = 'OutlineApproval';
                                    break;
                            }

                            if (!uiComponent) return null;

                            return {
                                role: 'assistant',
                                content: '',
                                uiComponent,
                                uiData,
                                timestamp: output.timestamp || 0
                            };
                        }).filter(Boolean)
                    ].sort((a, b) => a.timestamp - b.timestamp);

                    return combined.map((msg: any, idx: number) => (
                        <HistoryMessage key={idx} message={msg} />
                    ));
                })()}
            </div>

            {/* Generated Blog (if available) */}
            {thread.agentState?.draft && (
                <div className="mt-8 border-t pt-6">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800">Generated Blog</h2>
                    <div
                        className="prose max-w-none bg-gray-50 p-6 rounded-lg"
                        dangerouslySetInnerHTML={{ __html: thread.agentState.draft }}
                    />
                </div>
            )}
        </div>
    );
};

export default HistoryThreadViewer;
