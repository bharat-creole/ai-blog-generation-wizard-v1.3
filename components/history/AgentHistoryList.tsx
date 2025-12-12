import React, { useEffect, useState } from 'react';
import { getAuthHeaders } from '../../services/authUtils';

interface HistoryItem {
    id: string;
    threadId: string;
    title: string;
    topic: string;
    messageCount: number;
    lastMessageAt: string;
    blogGenerated: boolean;
    status: string;
}

const API_BASE = import.meta.env?.VITE_AGENT_API_BASE || 'http://localhost:3001';

export const AgentHistoryList: React.FC = () => {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/agent/history`, {
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Failed to fetch history');
            }

            const data = await response.json();
            setHistory(data.history);
        } catch (error: any) {
            console.error('Failed to fetch history:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const openThread = (threadId: string) => {
        // Navigate to history viewer
        window.location.href = `/history/${threadId}`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-gray-600">Loading conversation history...</div>
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

    if (history.length === 0) {
        return (
            <div className="p-6 text-center">
                <p className="text-gray-600">No conversation history yet.</p>
                <p className="text-sm text-gray-500 mt-2">Start a new conversation to see it here!</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">My Conversations</h1>

            <div className="space-y-4">
                {history.map(item => (
                    <div
                        key={item.id}
                        onClick={() => openThread(item.threadId)}
                        className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg cursor-pointer transition-shadow"
                    >
                        <h3 className="text-xl font-semibold mb-2 text-gray-800">
                            {item.title}
                        </h3>

                        {item.topic && (
                            <p className="text-gray-600 mb-3">
                                <span className="font-medium">Topic:</span> {item.topic}
                            </p>
                        )}

                        <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                                💬 {item.messageCount} messages
                            </span>
                            <span>
                                📅 {new Date(item.lastMessageAt).toLocaleDateString()}
                            </span>
                            {item.blogGenerated && (
                                <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">
                                    ✅ Blog Generated
                                </span>
                            )}
                            <span className={`px-2 py-1 rounded text-xs font-medium ${item.status === 'completed'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                {item.status}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AgentHistoryList;
