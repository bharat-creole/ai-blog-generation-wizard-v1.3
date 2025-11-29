import {
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
} from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { db } from './db';

/**
 * Simplified BrowserCheckpointer for IndexedDB persistence
 * This is a minimal implementation to get the V2 agent working
 * Full checkpoint history and writes support can be added later
 */
export class BrowserCheckpointer extends BaseCheckpointSaver {
    constructor() {
        super();
    }

    async getTuple(
        config: RunnableConfig
    ): Promise<CheckpointTuple | undefined> {
        const thread_id = config.configurable?.thread_id;
        if (!thread_id) return undefined;

        const record = await db.checkpoints.get(thread_id);
        if (!record) return undefined;

        const checkpoint = JSON.parse(record.checkpoint) as Checkpoint;
        const metadata = JSON.parse(record.metadata) as CheckpointMetadata;

        return {
            config: {
                configurable: {
                    thread_id,
                    checkpoint_id: checkpoint.id,
                },
            },
            checkpoint,
            metadata,
            parentConfig: record.parent_checkpoint_id
                ? {
                    configurable: {
                        thread_id,
                        checkpoint_id: record.parent_checkpoint_id,
                    },
                }
                : undefined,
        };
    }

    async *list(
        config: RunnableConfig,
        options?: { limit?: number; before?: RunnableConfig }
    ): AsyncGenerator<CheckpointTuple> {
        const thread_id = config.configurable?.thread_id;
        if (!thread_id) return;

        const record = await db.checkpoints.get(thread_id);
        if (record) {
            const checkpoint = JSON.parse(record.checkpoint) as Checkpoint;
            yield {
                config: {
                    configurable: {
                        thread_id,
                        checkpoint_id: checkpoint.id,
                    },
                },
                checkpoint,
                metadata: JSON.parse(record.metadata) as CheckpointMetadata,
            };
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        const thread_id = config.configurable?.thread_id;
        if (!thread_id) {
            throw new Error('thread_id is required for saving checkpoints');
        }

        await db.checkpoints.put({
            id: thread_id,
            checkpoint: JSON.stringify(checkpoint),
            metadata: JSON.stringify(metadata),
            parent_checkpoint_id: config.configurable?.checkpoint_id,
            updated_at: Date.now(),
        });

        return {
            configurable: {
                thread_id,
                checkpoint_id: checkpoint.id,
            },
        };
    }

    // Stub implementations for abstract methods
    async putWrites(config: RunnableConfig, writes: any[], taskId: string): Promise<void> {
        // Simplified: store writes in IndexedDB for future retrieval
        const thread_id = config.configurable?.thread_id;
        if (!thread_id) return;

        await db.transaction('rw', db.writes, async () => {
            for (const [idx, write] of writes.entries()) {
                const [channel, value] = Array.isArray(write) ? write : [write, null];
                await db.writes.put({
                    id: `${thread_id}_${taskId}_${idx}`,
                    thread_id,
                    task_id: taskId,
                    idx,
                    channel: channel || 'default',
                    value: JSON.stringify(value),
                    updated_at: Date.now(),
                });
            }
        });
    }
}
