import React from 'react';
import { AgentState } from '../../../services/langgraph/agentGraph';

interface BlogInfoPanelProps {
    show: boolean;
    agent: AgentState | null;
}

const BlogInfoPanel: React.FC<BlogInfoPanelProps> = ({ show, agent }) => {
    if (!show) return null;

    return (
        <div className='mb-4 flex-shrink-0'>
            <div className='p-4 border-2 border-orange-500 rounded-lg bg-white text-xs max-h-48 overflow-y-auto shadow-lg'>
                {agent && (
                    <div className='space-y-2'>
                        {/* Primary Keyword */}
                        {agent.data.primaryKeyword && (
                            <div>
                                <span className='font-semibold text-gray-700'>
                                    Primary Keyword:
                                </span>{' '}
                                <span className='text-blue-700'>
                                    {agent.data.primaryKeyword}
                                </span>
                            </div>
                        )}

                        {/* Secondary Keywords */}
                        {agent.data.secondaryKeywords &&
                            agent.data.secondaryKeywords.length > 0 && (
                                <div>
                                    <span className='font-semibold text-gray-700'>
                                        Secondary Keywords:
                                    </span>{' '}
                                    <span className='text-blue-700'>
                                        {agent.data.secondaryKeywords.join(', ')}
                                    </span>
                                </div>
                            )}

                        {/* Title */}
                        {agent.data.title && (
                            <div>
                                <span className='font-semibold text-gray-700'>
                                    Title:
                                </span>{' '}
                                <span className='text-blue-700'>
                                    {agent.data.title}
                                </span>
                            </div>
                        )}

                        {/* Outline */}
                        {agent.outline && agent.outline.length > 0 && (
                            <div>
                                <div className='font-semibold text-gray-700 mb-1'>
                                    Outline:
                                </div>
                                <div className='ml-2 space-y-1'>
                                    {agent.outline.map((section, idx) => (
                                        <div key={section.id}>
                                            <div className='text-blue-700'>
                                                {idx + 1}. {section.name}
                                            </div>
                                            {section.items && section.items.length > 0 && (
                                                <div className='ml-3 text-gray-600'>
                                                    {section.items.map((item) => (
                                                        <div key={item.id}>
                                                            • {item.name}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!agent.data.primaryKeyword &&
                            !agent.data.title &&
                            (!agent.outline || agent.outline.length === 0) && (
                                <div className='text-gray-500'>
                                    No blog info yet. Start by sending a message.
                                </div>
                            )}
                    </div>
                )}
                {!agent && (
                    <div className='text-gray-500'>
                        Start a conversation to see blog generation info.
                    </div>
                )}
            </div>
        </div>
    );
};

export default BlogInfoPanel;
