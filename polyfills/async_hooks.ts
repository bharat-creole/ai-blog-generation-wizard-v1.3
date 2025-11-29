// Browser-compatible shim for Node.js async_hooks module
// Used by @langchain/langgraph in browser environments

export class AsyncLocalStorage {
    private storage = new Map();
    private currentId = 0;

    run(store: any, callback: (...args: any[]) => any, ...args: any[]) {
        const id = this.currentId++;
        this.storage.set(id, store);
        try {
            return callback(...args);
        } finally {
            this.storage.delete(id);
        }
    }

    getStore() {
        // Return the most recent store (simplified)
        const entries = Array.from(this.storage.entries());
        if (entries.length === 0) return undefined;
        return entries[entries.length - 1][1];
    }

    enterWith(store: any) {
        const id = this.currentId++;
        this.storage.set(id, store);
    }

    disable() {
        this.storage.clear();
    }

    exit(callback: (...args: any[]) => any, ...args: any[]) {
        return callback(...args);
    }
}

export default {
    AsyncLocalStorage,
};
