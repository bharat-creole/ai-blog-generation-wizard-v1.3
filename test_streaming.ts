import fetch from 'node-fetch';

async function testStreaming() {
    const response = await fetch('http://localhost:3001/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: 'Generate blog automatically on topic AI Agents',
            threadId: `test-thread-${Date.now()}`,
            currentState: {
                messages: [],
                data: {},
                apiKey: 'test-key', // Mock key, backend might need a real one or mock the service
                preferences: { automationLevel: 'full' }
            },
            stream: true
        })
    });

    if (!response.ok) {
        console.error('Error:', await response.text());
        return;
    }

    console.log('--- Stream Started ---');

    // @ts-ignore
    for await (const chunk of response.body) {
        const text = chunk.toString();
        console.log(text);
    }

    console.log('--- Stream Ended ---');
}

testStreaming().catch(console.error);
