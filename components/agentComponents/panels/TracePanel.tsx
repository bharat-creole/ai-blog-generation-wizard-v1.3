import React from 'react';

interface TracePanelProps {
    show: boolean;
    traceItems: { step: string; at: number }[];
}

const TracePanel: React.FC<TracePanelProps> = ({ show, traceItems }) => {
    if (!show) return null;

    return (
        <div className='mb-4'>
            <div className='p-3 border border-gray-200 rounded-lg bg-gray-50 max-h-40 overflow-auto text-xs text-gray-700'>
                {traceItems.length === 0 && (
                    <div>No steps yet.</div>
                )}
                {traceItems.map((t, idx) => (
                    <div key={idx}>
                        {new Date(t.at).toLocaleTimeString()}: {t.step}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TracePanel;
