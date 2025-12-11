// server/db/agentHistoryService.ts

import { PrismaClient } from '@prisma/client';
import { AgentState } from '../agent/state';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

export interface AgentHistorySaveData {
    threadId: string;
    userId: string;
    messages: any[];  // Messages with UI metadata
    agentState: AgentState;
    topic?: string;
    blogGenerated?: boolean;
}

/**
 * Save or update agent history in database
 */
export const saveAgentHistory = async (data: AgentHistorySaveData): Promise<void> => {
    try {
        // Generate title from topic or first user message
        const title = data.topic || 
                     data.messages.find(m => m.role === 'user')?.content.substring(0, 100) ||
                     'Untitled Conversation';

        const historyData = {
            userId: data.userId,
            title: title.substring(0, 500),
            topic: data.topic?.substring(0, 250),
            messages: data.messages,
            agentState: data.agentState as any,
            messageCount: data.messages.length,
            lastMessageAt: new Date(),
            blogGenerated: data.blogGenerated || false,
            status: data.blogGenerated ? 'completed' : 'active'
        };

        const existing = await prisma.agent_history.findUnique({
            where: { threadId: data.threadId }
        });

        if (existing) {
            await prisma.agent_history.update({
                where: { threadId: data.threadId },
                data: { ...historyData, updatedAt: new Date() }
            });
            console.log(`✅ [HISTORY] Updated threadId: ${data.threadId}`);
        } else {
            await prisma.agent_history.create({
                data: {
                    id: randomUUID(),
                    threadId: data.threadId,
                    ...historyData
                }
            });
            console.log(`✅ [HISTORY] Created threadId: ${data.threadId}`);
        }
    } catch (error) {
        console.error('❌ [HISTORY] Save failed:', error);
        // Don't throw - we don't want to fail the request if history save fails
    }
};

/**
 * Get chat history for a user
 */
export const getUserHistory = async (
    userId: string,
    options?: { limit?: number; offset?: number; status?: string }
): Promise<any[]> => {
    const { limit = 20, offset = 0, status } = options || {};

    return await prisma.agent_history.findMany({
        where: {
            userId,
            deletedAt: null,
            ...(status && { status })
        },
        select: {
            id: true,
            threadId: true,
            title: true,
            topic: true,
            status: true,
            messageCount: true,
            lastMessageAt: true,
            blogGenerated: true,
            createdAt: true
        },
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        skip: offset
    });
};

/**
 * Get full history thread
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Get full history thread
 */
export const getHistoryThread = async (threadId: string): Promise<any | null> => {
    // First get the DB record to verify existence and ownership
    const dbRecord = await prisma.agent_history.findUnique({
        where: { threadId },
        include: {
            users: {
                select: {
                    id: true,
                    username: true,
                    email: true
                }
            }
        }
    });

    if (!dbRecord) {
        return null;
    }

    // Try to read from checkpoint file
    try {
        const filePath = join(process.cwd(), 'server', 'data', 'checkpoints', `${threadId}.json`);
        const fileContent = await readFile(filePath, 'utf-8');
        const fileData = JSON.parse(fileContent);

        // Check for nested checkpoint structure (LangGraph format)
        // It can be at root or under "checkpoint" key
        const checkpoint = fileData.checkpoint || fileData;
        
        if (checkpoint && checkpoint.channel_values) {
            console.log(`✅ [HISTORY] Loaded thread ${threadId} from checkpoint file`);
            
            // Merge file data with DB metadata
            // The file contains the most up-to-date state in channel_values
            const state = checkpoint.channel_values;
            
            return {
                ...dbRecord,
                // Use messages from file if available, otherwise fallback to DB
                messages: state.messages || dbRecord.messages,
                // Use full state from file
                agentState: state
            };
        }
    } catch (error) {
        // File not found or invalid, fall back to DB record
        console.warn(`⚠️ [HISTORY] Could not read checkpoint file for ${threadId}, using DB record:`, error);
    }

    return dbRecord;
};

/**
 * Delete history (soft delete)
 */
export const deleteHistory = async (threadId: string): Promise<void> => {
    await prisma.agent_history.update({
        where: { threadId },
        data: { deletedAt: new Date() }
    });
};

// Graceful shutdown
process.on('beforeExit', async () => {
    await prisma.$disconnect();
});

