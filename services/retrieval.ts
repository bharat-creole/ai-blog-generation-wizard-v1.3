import { ReferenceFile, BlogData } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
// Configure pdf.js worker for Vite
// Vite will turn this into a URL string we can assign to workerSrc
// pdfjs-dist v4 uses ESM worker filename `pdf.worker.min.mjs`
// Fallback to .js can be added later if needed
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
// @ts-ignore
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;
import { GoogleGenAI } from '@google/genai';

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

const cosineSim = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
};

const getPdfPageTexts = async (file: ReferenceFile): Promise<{ page: number; text: string }[]> => {
  const data = base64ToUint8Array(file.base64);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: { page: number; text: string }[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => ('str' in it ? it.str : '')).join('\n');
    pages.push({ page: p, text });
  }
  return pages;
};

const getDocxText = async (file: ReferenceFile): Promise<string> => {
  const { convertToHtml } = await import('mammoth');
  const bytes = base64ToUint8Array(file.base64);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await convertToHtml({ arrayBuffer });
  const text = result.value.replace(/<[^>]+>/g, '\n');
  return text;
};

const getTxtText = async (file: ReferenceFile): Promise<string> => {
  return new TextDecoder().decode(base64ToUint8Array(file.base64));
};

export interface SelectedReference {
  type: 'file' | 'text';
  name?: string;
  page?: number;
  content?: string;
  mimeType?: string;
  base64?: string;
}

export const selectReferences = async (data: BlogData, apiKey: string): Promise<SelectedReference[]> => {
  const selected: SelectedReference[] = [];
  const keyword = (data.primaryKeyword || data.title || '').trim();
  const chunkSize = 1200;
  const chunkOverlap = 150;
  const texts: string[] = [];
  const metadatas: any[] = [];

  for (const f of data.referenceFiles) {
    if (f.mimeType === 'application/pdf') {
      const pages = await getPdfPageTexts(f);
      if (pages.length <= 23) {
        selected.push({ type: 'file', name: f.name, mimeType: f.mimeType, base64: f.base64 });
      } else {
        for (const p of pages) {
          texts.push(p.text);
          metadatas.push({ source: f.name, page: p.page, type: 'pdf' });
        }
      }
    } else if (f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || f.name.toLowerCase().endsWith('.docx')) {
      const text = await getDocxText(f);
      const words = text.split(/\s+/).filter(Boolean);
      const approxPages = Math.max(1, Math.round(words.length / 500));
      if (approxPages <= 23) {
        selected.push({ type: 'file', name: f.name, mimeType: 'text/plain', base64: btoa(unescape(encodeURIComponent(text))) });
      } else {
        // simple character-based chunking
        for (let i = 0; i < text.length; i += (chunkSize - chunkOverlap)) {
          const chunk = text.slice(i, i + chunkSize);
          if (chunk.trim().length > 0) {
            texts.push(chunk);
            metadatas.push({ source: f.name, page: Math.floor(i / (chunkSize - chunkOverlap)) + 1, type: 'docx' });
          }
        }
      }
    } else if (f.mimeType === 'text/plain' || f.name.toLowerCase().endsWith('.txt')) {
      const text = await getTxtText(f);
      selected.push({ type: 'text', name: f.name, content: text });
    }
  }

  if (texts.length > 0 && keyword) {
    const ai = new GoogleGenAI({ apiKey });
    const embed = async (input: string) => {
      const res = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ role: 'user', parts: [{ text: input }] }],
      });
      return (res.embeddings?.[0]?.values || []) as number[];
    };
    const qv = await embed(keyword);
    const vecs: number[][] = [];
    for (const t of texts) {
      const v = await embed(t);
      vecs.push(v);
    }
    const scored = vecs.map((v, i) => ({ i, score: cosineSim(qv, v) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 20);
    for (const { i } of top) {
      selected.push({ type: 'text', name: metadatas[i]?.source, page: metadatas[i]?.page, content: texts[i] });
    }
  }

  return selected;
};

export const toVirtualFiles = (selected: SelectedReference[]): ReferenceFile[] => {
  const virtuals: ReferenceFile[] = [];
  for (const s of selected) {
    if (s.type === 'file' && s.base64 && s.mimeType) {
      virtuals.push({ name: s.name || 'reference', mimeType: s.mimeType, base64: s.base64 });
    } else if (s.type === 'text' && s.content) {
      const b64 = btoa(unescape(encodeURIComponent(s.content)));
      virtuals.push({ name: `${s.name || 'chunk'}${s.page ? `_p${s.page}` : ''}.txt`, mimeType: 'text/plain', base64: b64 });
    }
  }
  return virtuals;
};
