// Helper function to convert file to base64
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // Remove "data:mime/type;base64," prefix
            resolve(result.split(',')[1]);
        };
        reader.onerror = (error) => reject(error);
    });
};

// Helper function to convert trace steps to user-friendly messages
export const getStepMessage = (
    step: string,
    info?: Record<string, any>
): string | null => {
    const messages: Record<string, string> = {
        'KeywordResearch.primaryCandidates': `🔍 Researched ${info?.count || 0
            } keyword options`,
        'KeywordResearch.autoSelected': `✅ Selected "${info?.keyword}" as primary keyword`,
        'KeywordResearch.userProvided': `✅ Using your keyword: "${info?.keyword}"`,
        'KeywordResearch.secondaryCandidates': `🔍 Found ${info?.count || 0
            } secondary keyword options`,
        'KeywordResearch.secondaryAutoSelected': `✅ Selected ${info?.count || 0
            } secondary keywords`,
        'KeywordResearch.secondaryUserProvided': `✅ Using your ${info?.count || 0
            } secondary keywords`,
        'TitleGeneration.generated': `📝 Generated ${info?.count || 0
            } title options`,
        'TitleGeneration.autoSelected': `✅ Selected title: "${info?.title}"`,
        'TitleGeneration.userProvided': `✅ Using your title: "${info?.title}"`,
        'Interlinking.prompted': `🔗 Ready to add internal/external links (optional)`,
        'Interlinking.autoSkipped': `⏭️ Skipped interlinking step`,
        'Interlinking.userProvided': `✅ Added ${info?.count || 0} links`,
        'ReferencesCollection.prompted': `📚 Ready to add reference URLs (optional)`,
        'ReferencesCollection.autoSkipped': `⏭️ Skipped references step`,
        'ReferencesCollection.userProvided': `✅ Added ${info?.count || 0
            } references`,
        'DiscoveryNode.generatedOutline': `📋 Generated outline with ${info?.h2Count || 0
            } sections`,
        'DiscoveryNode.regeneratedOutline': `🔄 Regenerated outline with ${info?.h2Count || 0
            } sections based on your feedback`,
        'ProposalNode.generatedSection': `✍️ Writing section ${(info?.sectionIndex || 0) + 1
            }: ${info?.section}`,
        'FinalBlog.generated': `🎉 Blog complete! ${info?.wordCount || 0
            } words`,
        'EstimatorNode.ranked': `📊 SEO analysis complete`,
    };

    return messages[step] || null;
};

// Analyze user intent for intelligent flow detection
export const analyzeUserIntent = (content: string) => {
    // Check for automation requests
    const wantsFullAutomation =
        /generate.*automatically|auto.*generate|create.*automatic|full.*automation|generate blog automatically/i.test(
            content
        );
    const wantsAutomation =
        /automat|auto.*select|auto.*choose|proceed.*automatic/i.test(
            content
        );

    // Check for general blog generation requests (without "automatically")
    const wantsBlogGeneration =
        /^(generate|create|write|make|build|produce)\s+(a\s+|an\s+|the\s+)?(blog|article|post|content)/i.test(
            content
        ) && !wantsFullAutomation;

    // Check for information provided
    const hasDetailedInfo =
        /keyword|title|location|country|reference|link|url|target|primary|secondary|topic/i.test(
            content
        );

    // Check for modification requests
    const wantsModification =
        /change|modify|update|edit|different|instead|replace|go back/i.test(
            content
        );

    // Check for irrelevant queries
    const isIrrelevant =
        !hasDetailedInfo &&
        !wantsFullAutomation &&
        !wantsAutomation &&
        !wantsModification &&
        !wantsBlogGeneration &&
        !/blog|content|article|post|write|seo/i.test(content);

    return {
        wantsFullAutomation,
        wantsAutomation,
        wantsBlogGeneration,
        hasDetailedInfo,
        wantsModification,
        isIrrelevant,
    };
};

// Helper function to extract topic from text
export const extractTopicFromText = (text: string): string | null => {
    // Try to extract topic from patterns like:
    // "generate blog about AI in healthcare"
    // "create article on remote work"
    // "write blog for web development"
    const patterns = [
        /(?:about|on|regarding|concerning|for)\s+(.+)/i,
        /(?:topic|subject):\s*(.+)/i,
        /(?:generate|create|write|make)\s+(?:blog|article|post|content)\s+(.+)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].trim();
            // Make sure it's not just keywords like "automatically"
            if (
                extracted.length > 5 &&
                !/^(automatically|auto|manually|guided)$/i.test(
                    extracted
                )
            ) {
                return extracted;
            }
        }
    }
    return null;
};

// Check if topic exists in previous messages
export const findTopicInHistory = (
    messages: any[],
    intent: ReturnType<typeof analyzeUserIntent>
): string | null => {
    // Look through last 5 messages for a topic
    const recentMessages = messages.slice(-5);
    for (const msg of recentMessages) {
        if (msg.role === 'user') {
            const extracted = extractTopicFromText(msg.content);
            if (extracted) return extracted;

            // Check if it's a simple topic statement
            const content = msg.content.trim();
            if (
                content.length > 5 &&
                content.length < 150 &&
                !/^(generate|create|write|make|yes|no|ok|sure)/i.test(
                    content
                ) &&
                !intent.wantsModification
            ) {
                return content;
            }
        }
    }
    return null;
};
