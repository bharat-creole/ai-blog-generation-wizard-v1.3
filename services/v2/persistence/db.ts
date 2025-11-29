import Dexie, { Table } from 'dexie';

export interface CheckpointRecord {
    id: string; // thread_id
    checkpoint: string; // JSON stringified Checkpoint
    metadata: string; // JSON stringified CheckpointMetadata
    parent_checkpoint_id?: string;
    updated_at: number;
}

export interface CheckpointWriteRecord {
    id: string; // composite key or unique id
    thread_id: string;
    task_id: string;
    idx: number;
    channel: string;
    value: string; // JSON stringified value
    updated_at: number;
}

export class BlogAgentDB extends Dexie {
    checkpoints!: Table<CheckpointRecord>;
    writes!: Table<CheckpointWriteRecord>;

    constructor() {
        super('BlogAgentDB');
        this.version(1).stores({
            checkpoints: 'id, parent_checkpoint_id, updated_at',
            writes: 'id, thread_id, task_id, idx, channel, value, updated_at',
        });
    }
}

export const db = new BlogAgentDB();
