import React from 'react';
import type { AutomationLevel } from '../../types';
import type { FlowContext, AgentState } from '../../types';

interface AgentModeHeaderProps {
    flowContext: FlowContext;
    setFlowContext: React.Dispatch<React.SetStateAction<FlowContext>>;
    agent?: AgentState;
    setAgent: React.Dispatch<React.SetStateAction<AgentState | undefined>>;
}

const AgentModeHeader: React.FC<AgentModeHeaderProps> = ({ flowContext, setFlowContext, agent, setAgent }) => {
    return (
        <div className="mb-5 p-4 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border border-blue-200/50 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <span className="text-lg">⚙️</span>
                    Control Level:
                </div>
                <div className="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-full shadow-lg font-semibold">
                    Active:{' '}
                    {flowContext.automationLevel === 'full'
                        ? '🚀 Full Automation'
                        : flowContext.automationLevel === 'guided'
                            ? '🎯 Guided'
                            : '✋ Manual'}
                </div>
            </div>
            <div className="flex gap-3">
                <label
                    className={`flex items-center gap-2 ${agent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                    <input
                        type="radio"
                        name="automation-mode"
                        value="full"
                        checked={flowContext.automationLevel === 'full'}
                        disabled={!!agent}
                        onChange={e =>
                            setFlowContext(prev => ({ ...prev, automationLevel: e.target.value as AutomationLevel }))
                        }
                        className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm">
                        <strong>Full Automation</strong> - I decide everything
                    </span>
                </label>
                <label
                    className={`flex items-center gap-2 ${agent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                    <input
                        type="radio"
                        name="automation-mode"
                        value="guided"
                        checked={flowContext.automationLevel === 'guided'}
                        disabled={!!agent}
                        onChange={e =>
                            setFlowContext(prev => ({ ...prev, automationLevel: e.target.value as AutomationLevel }))
                        }
                        className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm">
                        <strong>Guided</strong> - I approve key decisions
                    </span>
                </label>
                <label
                    className={`flex items-center gap-2 ${agent ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                    <input
                        type="radio"
                        name="automation-mode"
                        value="manual"
                        checked={flowContext.automationLevel === 'manual'}
                        disabled={!!agent}
                        onChange={e =>
                            setFlowContext(prev => ({ ...prev, automationLevel: e.target.value as AutomationLevel }))
                        }
                        className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm">
                        <strong>Manual</strong> - I control everything
                    </span>
                </label>
            </div>
        </div>
    );
};

export default AgentModeHeader;
