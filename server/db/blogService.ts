// server/db/blogService.ts

import { PrismaClient } from '@prisma/client';
import { OutlineSection, Interlink } from '../../types';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

export interface BlogSaveData {
    threadId: string;
    title: string;
    topic: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    content: string;
    outline: OutlineSection[];
    targetLocation: string;
    referenceUrls: string[];
    interlinks: Interlink[];
    automationLevel?: string;
    createdAt: Date;
    userId?: string; // Optional: if you want to associate with a user
}

/**
 * Saves a blog post to the database using the existing blogs table
 * Maps our agent data structure to the existing blogs table schema
 */
export const saveBlogToDatabase = async (data: BlogSaveData): Promise<void> => {
    try {
        console.log(data)
        // ✨ FIX: Simplified metadata to avoid VARCHAR(255) limit
        // Store only essential metadata (no outline - it's too large)
        const metadata = {
            threadId: data.threadId,
            topic: data.topic?.substring(0, 100) || '', // Truncate to 100 chars
            primaryKeyword: data.primaryKeyword?.substring(0, 100) || '',
            targetLocation: data.targetLocation,
            automationLevel: data.automationLevel,
            // Removed outline and interlinks - they're too large for VARCHAR(255)
        };

        // Convert content to array format (as expected by blogs.content field)
        const contentArray = data.content.split('\n').filter(line => line.trim().length > 0);

        // ✨ FIX: Truncate secondary keywords to fit VARCHAR(255)
        const secondaryKeywordsStr = data.secondaryKeywords.join(', ').substring(0, 250);

        // ✨ FIX: Truncate reference URLs to fit VARCHAR(255)
        const referenceUrlsStr = data.referenceUrls.join(', ').substring(0, 200);

        // ✨ FIX: Truncate title to fit VARCHAR(255)
        const truncatedTitle = data.title?.substring(0, 250) || 'Untitled';

        // ✨ FIX: Simplify interlinks JSON to fit VARCHAR(255)
        // Store only the count or first few links
        const interlinksSummary = data.interlinks && data.interlinks.length > 0
            ? JSON.stringify({ count: data.interlinks.length, sample: data.interlinks.slice(0, 2) })
            : '{}';
        const truncatedInterlinks = interlinksSummary.substring(0, 250);

        // ✨ FIX: Create compact referenceLink JSON
        const referenceLinkJson = JSON.stringify({ ...metadata, referenceUrls: referenceUrlsStr });
        const truncatedReferenceLink = referenceLinkJson.substring(0, 250);

        // Check if blog exists by searching in referenceLink metadata
        const existingBlog = await prisma.blogs.findFirst({
            where: {
                referenceLink: {
                    contains: `"threadId":"${data.threadId}"`,
                },
            },
        });

        if (existingBlog) {
            // Update existing blog
            await prisma.blogs.update({
                where: { id: existingBlog.id },
                data: {
                    title: truncatedTitle,
                    secondaryKeywords: secondaryKeywordsStr,
                    referenceLink: truncatedReferenceLink,
                    internalLinks: truncatedInterlinks,
                    content: contentArray,
                    updatedAt: new Date(),
                },
            });
            console.log(`✅ [DB] Blog updated for threadId: ${data.threadId}`);
        } else {
            // Create new blog
            await prisma.blogs.create({
                data: {
                    id: randomUUID(),
                    userId: data.userId || null,
                    title: truncatedTitle,
                    secondaryKeywords: secondaryKeywordsStr,
                    referenceLink: truncatedReferenceLink,
                    internalLinks: truncatedInterlinks,
                    content: contentArray,
                    language: [], 
                    words: [], 
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            console.log(`✅ [DB] Blog created for threadId: ${data.threadId}`);
            console.log(`   📏 Data lengths: title=${truncatedTitle.length}, keywords=${secondaryKeywordsStr.length}, refLink=${truncatedReferenceLink.length}, links=${truncatedInterlinks.length}`);

            // Update user usage and create log entry (only for new blogs and if userId is provided)
            if (data.userId) {
                try {
                    // Find user usage record
                    const blogUsage = await prisma.user_usages.findFirst({
                        where: { userId: data.userId },
                    });

                    if (blogUsage) {
                        // Update blogCreated count
                        const updatedBlogCreated = (blogUsage.blogCreated || 0) + 1;
                        await prisma.user_usages.update({
                            where: { id: blogUsage.id },
                            data: {
                                blogCreated: updatedBlogCreated,
                            },
                        });

                        // Create log entry
                        await prisma.logs.create({
                            data: {
                                userId: data.userId,
                                message: '1 Blog count is used',
                                event: ['BLOG_CREATED'],
                                count: -1,
                                totalCount: (blogUsage.blogLimit || 0) - updatedBlogCreated,
                            },
                        });

                        console.log(`✅ [DB] User usage updated and log created for userId: ${data.userId}`);
                    } else {
                        console.warn(`⚠️  [DB] User usage record not found for userId: ${data.userId}`);
                    }
                } catch (usageError) {
                    // Don't fail the blog save if usage update fails
                    console.error('❌ [DB] Failed to update user usage or create log:', usageError);
                }
            }
        }
    } catch (error) {
        console.error('❌ [DB] Failed to save blog to database:', error);
        throw error;
    }
};

/**
 * Checks if a blog exists for the given threadId
 */
export const blogExists = async (threadId: string): Promise<boolean> => {
    try {
        const count = await prisma.blogs.count({
            where: {
                referenceLink: {
                    contains: `"threadId":"${threadId}"`,
                },
            },
        });
        return count > 0;
    } catch (error) {
        console.error('❌ [DB] Failed to check blog existence:', error);
        return false;
    }
};

// Graceful shutdown
process.on('beforeExit', async () => {
    await prisma.$disconnect();
});

