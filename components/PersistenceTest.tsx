import React, { useState, useEffect } from 'react';
import { graph } from '../services/v2/graph';
import { db } from '../services/v2/persistence/db';
import { useLiveQuery } from 'dexie-react-hooks';

export const PersistenceTest = () => {
    const [status, setStatus] = useState('Idle');
    const [threadId] = useState(`test-thread-${Date.now()}`);

    // Live query to watch the database
    const checkpoints = useLiveQuery(
        () => db.checkpoints.where('id').equals(threadId).toArray(),
        [threadId]
    );

    const runGraph = async () => {
        setStatus('Running...');
        try {
            const config = { configurable: { thread_id: threadId } };
            const stream = await graph.stream(
                { messages: [{ role: 'user', content: 'Hello' }] },
                config
            );

            for await (const chunk of stream) {
                console.log('Chunk:', chunk);
            }
            setStatus('Complete');
        } catch (err: any) {
            setStatus(`Error: ${err.message}`);
            console.error(err);
        }
    };

    return (
        <div className="p-4 border rounded shadow bg-white m-4">
            <h2 className="text-xl font-bold mb-4">Persistence Test</h2>
            <div className="mb-4">
                <p><strong>Thread ID:</strong> {threadId}</p>
                <p><strong>Status:</strong> {status}</p>
            </div>

            <button
                onClick={runGraph}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                disabled={status === 'Running...'}
            >
                Run Graph
            </button>

            <div className="mt-6">
                <h3 className="font-bold">Database Checkpoints ({checkpoints?.length || 0})</h3>
                <pre className="bg-gray-100 p-2 rounded mt-2 text-xs overflow-auto max-h-60">
                    {JSON.stringify(checkpoints, null, 2)}
                </pre>
            </div>
        </div>
    );
};
