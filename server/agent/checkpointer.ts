import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKPOINTS_DIR = path.join(__dirname, '../data/checkpoints');

/**
 * File-based checkpoint saver for Node.js backend
 * Stores checkpoints as JSON files, one per thread
 */
export class FileCheckpointer extends BaseCheckpointSaver {
    constructor() {
        super();
        this.ensureCheckpointsDir();
    }

    private async ensureCheckpointsDir() {
        try {
            await fs.mkdir(CHECKPOINTS_DIR, { recursive: true });
        } catch (error) {
            console.error('Failed to create checkpoints directory:', error);
        }
    }

    private getFilePath(threadId: string): string {
        return path.join(CHECKPOINTS_DIR, `${threadId}.json`);
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) return undefined;

        try {
            const filePath = this.getFilePath(threadId);
            const data = await fs.readFile(filePath, 'utf-8');
            const saved = JSON.parse(data);

            return {
                config: {
                    configurable: {
                        thread_id: threadId,
                        checkpoint_id: saved.checkpoint.id,
                    },
                },
                checkpoint: saved.checkpoint,
                metadata: saved.metadata,
                parentConfig: saved.parentCheckpointId
                    ? {
                        configurable: {
                            thread_id: threadId,
                            checkpoint_id: saved.parentCheckpointId,
                        },
                    }
                    : undefined,
            };
        } catch (error) {
            // File doesn't exist or can't be read
            return undefined;
        }
    }

    async *list(
        config: RunnableConfig,
        options?: { limit?: number; before?: RunnableConfig }
    ): AsyncGenerator<CheckpointTuple> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) return;

        const tuple = await this.getTuple(config);
        if (tuple) {
            yield tuple;
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) {
            throw new Error('thread_id is required for saving checkpoints');
        }

        const filePath = this.getFilePath(threadId);
        const data = {
            checkpoint,
            metadata,
            parentCheckpointId: config.configurable?.checkpoint_id,
            updatedAt: Date.now(),
        };

        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

        return {
            configurable: {
                thread_id: threadId,
                checkpoint_id: checkpoint.id,
            },
        };
    }

    async putWrites(
        config: RunnableConfig,
        writes: any[],
        taskId: string
    ): Promise<void> {
        // Simplified: we can extend this later if needed
        // For now, writes are included in the checkpoint
    }

    async deleteThread(threadId: string): Promise<void> {
        try {
            const filePath = this.getFilePath(threadId);
            await fs.unlink(filePath);
        } catch (error) {
            // Ignore if file doesn't exist
        }
    }
}
