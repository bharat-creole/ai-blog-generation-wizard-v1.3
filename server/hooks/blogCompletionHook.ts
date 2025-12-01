// server/hooks/blogCompletionHook.ts

import { AgentState } from '../agent/state';
import { saveBlogToDatabase, blogExists } from '../db/blogService';

/**
 * Checks if blog generation is complete
 */
export const isBlogComplete = (state: AgentState): boolean => {
    return !!(
        state.outlineApproved &&
        state.outline &&
        state.outline.length > 0 &&
        state.draft &&
        state.draft.trim().length > 0 &&
        (state.progress?.sectionIndex ?? 0) >= (state.outline?.length || 0)
    );
};

/**
 * Saves blog to database if generation is complete
 * Returns true if saved, false otherwise
 * Prevents duplicate saves by checking if blog already exists
 */
export const saveBlogIfComplete = async (
    state: AgentState,
    threadId: string,
    userId?: string
): Promise<boolean> => {
    if (!isBlogComplete(state)) {
        return false;
    }

    // Check if blog already exists to prevent duplicate saves
    const exists = await blogExists(threadId);
    if (exists) {
        console.log(`ℹ️  [DB] Blog already exists for threadId: ${threadId}, skipping save`);
        return false;
    }

    try {
        await saveBlogToDatabase({
            threadId: threadId,
            title: state.data.title,
            topic: state.data.topic,
            primaryKeyword: state.data.primaryKeyword,
            secondaryKeywords: state.data.secondaryKeywords || [],
            content: state.draft,
            outline: state.outline,
            targetLocation: state.data.targetLocation,
            referenceUrls: state.data.referenceUrls || [],
            interlinks: state.data.interlinks || [],
            automationLevel: state.preferences?.automationLevel,
            createdAt: new Date(),
            userId: userId,
        });
        
        console.log('✅ [DB] Blog saved to database successfully');
        return true;
    } catch (error) {
        console.error('❌ [DB] Failed to save blog to database:', error);
        // Don't throw - we don't want to fail the request if DB save fails
        return false;
    }
};

