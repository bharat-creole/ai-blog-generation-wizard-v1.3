declare module 'mammoth';
declare module 'pdfjs-dist';

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly GEMINI_API_KEY?: string;
  readonly VITE_PARENT_URL?: string;
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
