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
}

interface Props {
    collapsed: boolean;
    onSelectThread: (threadId: string) => void;
}

const API_BASE = import.meta.env?.VITE_AGENT_API_BASE || 'http://localhost:3001';

export const SidebarHistory: React.FC<Props> = ({ collapsed, onSelectThread }) => {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/agent/history?limit=10`, {
                headers: getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                setHistory(data.history);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setLoading(false);
        }
    };

    if (collapsed) {
        return (
            <div className="px-2 py-2">
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full p-2 hover:bg-gray-700 rounded flex items-center justify-center"
                    title="Conversation History"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </button>
            </div>
        );
    }

    return (
        <div className="px-4 py-2">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between text-sm font-medium text-gray-300 hover:text-white mb-2"
            >
                <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Recent Conversations
                </span>
                <svg
                    className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {expanded && (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                    {loading && (
                        <div className="text-xs text-gray-400 py-2">Loading...</div>
                    )}

                    {!loading && history.length === 0 && (
                        <div className="text-xs text-gray-400 py-2">No conversations yet</div>
                    )}

                    {history.map(item => (
                        <button
                            key={item.id}
                            onClick={() => onSelectThread(item.threadId)}
                            className="w-full text-left p-2 rounded hover:bg-gray-700 transition-colors group"
                        >
                            <div className="text-sm text-gray-200 truncate group-hover:text-white">
                                {item.title || item.topic || 'Untitled'}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-gray-400">
                                    {item.messageCount} msgs
                                </span>
                                {item.blogGenerated && (
                                    <span className="text-xs text-green-400">✓</span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SidebarHistory;
