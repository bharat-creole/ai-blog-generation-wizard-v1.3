import { GoogleGenAI } from '@google/genai';
import { BlogData, Interlink, OutlineSection } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const cleanAndParseJson = (text: string): any => {
  const cleanedText = text.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleanedText);
};

// Generate content for a single outline section (H2 and its H3s)
export const generateSectionContent = async (
  data: BlogData,
  section: OutlineSection,
  apiKey: string,
  opts: { targetKeyword: string; interlinks: Interlink[]; referenceUrls: string[] }
): Promise<string> => {
  if (!apiKey) throw new Error('API Key is required.');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `ROLE: You are an expert SEO Content Writer.
TASK: Write the content for one H2 section of a blog, including its H3 items if any.

GUIDELINES:
1. Follow the blog's tone and depth rules: use rich formatting (lists, tables where useful), E-E-A-T signals, accurate claims.
2. Integrate the primary keyword naturally: "${opts.targetKeyword}".
3. Integrate INTERNAL LINKS inline when relevant using Markdown [text](url):\n${opts.interlinks.map(l => `- ${l.keyword}: ${l.url}`).join('\n') || '(none)'}
4. Use references from the following URLs to ground facts. Paraphrase and synthesize; avoid long verbatim spans. Cite with inline numeric markers like [1], [2] and include a Sources list at the end of this section:\n${(opts.referenceUrls || []).map(u => `- ${u}`).join('\n') || '(none)'}
5. Output Markdown for ONLY this section.

BLOG TITLE: ${data.title}
SECTION (H2): ${section.name}
SUBHEADS (H3):\n${section.items?.map(i => `- ${i.name}`).join('\n') || '(none)'}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: { parts: [{ text: prompt }] },
    config: {
      tools: [
        { googleSearch: {} },
        { urlContext: {} },
      ],
    },
  });

  return response.text;
};

export const chatAgentRespond = async (
  messages: ChatMessage[],
  currentDraft: string,
  targetKeyword: string,
  apiKey: string,
  interlinks: Interlink[] = [],
  referenceUrls: string[] = []
): Promise<{ assistantMessage: string; draftDelta: string }> => {
  if (!apiKey) throw new Error('API Key is required.');
  const ai = new GoogleGenAI({ apiKey });

  const conversation = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const prompt = `ROLE: You are an expert Blog Agent that collaborates via chat to plan and write a blog.
INSTRUCTIONS:
1. Read the conversation so far and the current Markdown draft.
2. If the user asks for changes or new sections, propose improvements clearly, then produce an updated passage to append.
3. Maintain a professional, educational tone. Integrate the target keyword naturally: "${targetKeyword}".
4. If you detect URLs in the conversation, integrate them as Markdown links inline where contextually relevant. If there are many, also add a short "Further Reading" section with bullet links at the end of the draft.
5. Keep responses concise. Use lists and short paragraphs. If producing content, write in Markdown.
6. OUTPUT ONLY a JSON object with exactly two string fields: assistantMessage and draftDelta. assistantMessage is your reply in chat; draftDelta is the content to append to the draft (may be empty string if no change to draft). Do not include any extra commentary or code fences.

CONVERSATION:
---
${conversation}
---

CURRENT DRAFT (Markdown):
---
${currentDraft}
---`;

  const interlinkBlock = interlinks.length
    ? `\n\nINTERNAL LINKS TO INTEGRATE (use as contextual Markdown links):\n${interlinks
        .map((l) => `- ${l.keyword}: ${l.url}`)
        .join('\n')}`
    : '';

  const urlsFromChat = Array.from(
    new Set(
      messages
        .map(m => m.content.match(/https?:\/\/[^\s)]+/g) || [])
        .flat()
    )
  );
  const allUrls = Array.from(new Set([...(referenceUrls || []), ...urlsFromChat]));

  const refsBlock = allUrls.length
    ? `\n\nREFERENCE URLS (the model may fetch via urlContext):\n${allUrls.map(u => `- ${u}`).join('\n')}`
    : '';

  const finalPrompt = prompt + interlinkBlock + refsBlock;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: { parts: [{ text: finalPrompt }] },
    config: {
      tools: [
        { googleSearch: {} },
        { urlContext: {} },
      ],
    }
  });

  return cleanAndParseJson(response.text);
};
