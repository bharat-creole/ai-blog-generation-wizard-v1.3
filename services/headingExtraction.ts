import { ReferenceFile } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
// Configure pdf.js worker for Vite (ESM worker)
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
// @ts-ignore
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

const detectHeadingsFromText = (text: string): string[] => {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const headings: string[] = [];
  for (const line of lines) {
    if (line.length > 120) continue;
    const isCandidate = /^(\d+\.|[IVXLC]+\.|[#\-\*])?\s*[A-Z][A-Za-z0-9'"()\-:,&\/ ]+$/.test(line) && /[A-Za-z]/.test(line) && !/[.;]$/.test(line);
    if (isCandidate) headings.push(line.replace(/^\d+\.|^[IVXLC]+\.|^[#\-\*]+\s*/, '').trim());
  }
  return Array.from(new Set(headings));
};

export const extractHeadingsFromPDF = async (file: ReferenceFile): Promise<{ headings: string[]; pageCount: number }> => {
  const data = base64ToUint8Array(file.base64);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const headings: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => ('str' in it ? it.str : '')).join('\n');
    headings.push(...detectHeadingsFromText(text));
  }
  return { headings: Array.from(new Set(headings)), pageCount: pdf.numPages };
};

export const extractHeadingsFromDOCX = async (file: ReferenceFile): Promise<{ headings: string[]; approxPages: number }> => {
  const { convertToHtml } = await import('mammoth');
  const bytes = base64ToUint8Array(file.base64);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await convertToHtml({ arrayBuffer });
  const text = result.value.replace(/<[^>]+>/g, '\n');
  const words = text.split(/\s+/).filter(Boolean);
  const approxPages = Math.max(1, Math.round(words.length / 500));
  const headings = detectHeadingsFromText(text);
  return { headings, approxPages };
};

export const extractHeadingsFromTXT = async (file: ReferenceFile): Promise<{ headings: string[]; approxPages: number }> => {
  const text = new TextDecoder().decode(base64ToUint8Array(file.base64));
  const words = text.split(/\s+/).filter(Boolean);
  const approxPages = Math.max(1, Math.round(words.length / 500));
  const headings = detectHeadingsFromText(text);
  return { headings, approxPages };
};

export const extractFromFiles = async (files: ReferenceFile[]) => {
  const byFile: { name: string; headings: string[] }[] = [];
  const mergedSet = new Set<string>();
  for (const f of files) {
    try {
      if (f.mimeType === 'application/pdf') {
        const { headings } = await extractHeadingsFromPDF(f);
        byFile.push({ name: f.name, headings });
        headings.forEach(h => mergedSet.add(h));
      } else if (f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || f.name.toLowerCase().endsWith('.docx')) {
        const { headings } = await extractHeadingsFromDOCX(f);
        byFile.push({ name: f.name, headings });
        headings.forEach(h => mergedSet.add(h));
      } else if (f.mimeType === 'text/plain' || f.name.toLowerCase().endsWith('.txt')) {
        const { headings } = await extractHeadingsFromTXT(f);
        byFile.push({ name: f.name, headings });
        headings.forEach(h => mergedSet.add(h));
      }
    } catch (_) {
      // ignore per-file extraction errors
    }
  }
  return { byFile, merged: Array.from(mergedSet) };
};
