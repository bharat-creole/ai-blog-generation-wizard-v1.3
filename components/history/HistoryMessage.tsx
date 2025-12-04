import React from 'react';
import PrimaryKeywordSelection from '../agentComponents/selections/PrimaryKeywordSelection';
import SecondaryKeywordSelection from '../agentComponents/selections/SecondaryKeywordSelection';
import TitleSelection from '../agentComponents/selections/TitleSelection';
import OutlineApproval from '../agentComponents/selections/OutlineApproval';
import InterlinkingForm from '../agentComponents/selections/InterlinkingForm';
import ReferencesForm from '../agentComponents/selections/ReferencesForm';
import { BlogData } from '../../types';

interface Props {
    message: any;
}

export const HistoryMessage: React.FC<Props> = ({ message }) => {
    const isUser = message.role === 'user';

    // Dummy props for read-only mode
    const dummySetState = () => { };
    const dummyUpdateData = () => { };
    const dummySendUserMessage = async () => ({ response: '', updatedState: {} as any });

    // Render UI components based on metadata
    const renderUIComponent = () => {
        if (!message.uiComponent || !message.uiData) {
            return null;
        }

        const commonProps = {
            agent: null,
            completedSelections: new Set(['primaryKeyword', 'secondaryKeywords', 'title', 'outline', 'interlinking', 'references']), // Mark all as completed to disable interaction
            setCompletedSelections: dummySetState,
            setMessages: dummySetState,
            setAgent: dummySetState,
            updateData: dummyUpdateData,
            setIsThinking: dummySetState,
            setOutline: dummySetState,
            setDraft: dummySetState,
            setTraceItems: dummySetState,
            sendUserMessage: dummySendUserMessage,
        };

        switch (message.uiComponent) {
            case 'PrimaryKeywordSelection':
                return (
                    <PrimaryKeywordSelection
                        {...commonProps}
                        candidates={message.uiData.candidates || []}
                    />
                );
            case 'SecondaryKeywordSelection':
                return (
                    <SecondaryKeywordSelection
                        {...commonProps}
                        candidates={message.uiData.candidates || []}
                        selectedSecondaries={message.uiData.selectedSecondaries || []}
                        setSelectedSecondaries={dummySetState}
                    />
                );
            case 'TitleSelection':
                return (
                    <TitleSelection
                        {...commonProps}
                        titles={message.uiData.titles || []}
                    />
                );
            case 'OutlineApproval':
                return (
                    <OutlineApproval
                        {...commonProps}
                        outline={message.uiData.outline || []}
                        messages={[]}
                        setInput={dummySetState}
                        setOutlineApproved={dummySetState}
                        setViewMode={dummySetState}
                        setShowBlogContent={dummySetState}
                    />
                );
            case 'InterlinkingForm':
                return (
                    <InterlinkingForm
                        {...commonProps}
                        currentLinks={message.uiData.interlinks || []}
                        data={{ interlinks: message.uiData.interlinks || [] } as BlogData}
                        messages={[]}
                    />
                );
            case 'ReferencesForm':
                return (
                    <ReferencesForm
                        {...commonProps}
                        currentUrls={message.uiData.referenceUrls || []}
                        currentFiles={message.uiData.referenceFiles || []}
                        data={{
                            referenceUrls: message.uiData.referenceUrls || [],
                            referenceFiles: message.uiData.referenceFiles || []
                        } as BlogData}
                    />
                );
            default:
                return (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="text-sm font-medium text-blue-800 mb-2">
                            Interactive Component: {message.uiComponent}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-3xl rounded-lg p-4 ${isUser
                ? 'bg-blue-100 text-blue-900'
                : 'bg-gray-100 text-gray-900'
                }`}>
                <div className="font-semibold mb-2 text-sm">
                    {isUser ? '👤 You' : '🤖 Assistant'}
                </div>

                {message.content && (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                )}

                {renderUIComponent()}

                {message.timestamp && (
                    <div className="text-xs text-gray-500 mt-2">
                        {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryMessage;
