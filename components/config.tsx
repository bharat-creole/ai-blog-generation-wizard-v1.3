// config.js

export function getEnvironmentConfig() {
  // Read all URLs from Vite env
  return {
    URL: (import.meta as any).env?.VITE_URL,
    BLOG_COUNT_URL: (import.meta as any).env?.VITE_BLOG_COUNT_URL,
    REGENERATION_URL: (import.meta as any).env?.VITE_REGENERATION_URL,
    PLAGIARISM_URL: (import.meta as any).env?.VITE_PLAGIARISM_URL,
    MY_BLOGS_URL: (import.meta as any).env?.VITE_MY_BLOGS_URL,
    BRAND_VOICE_URL: (import.meta as any).env?.VITE_BRAND_VOICE_URL,
    BLOG_GUIDELINES_URL: (import.meta as any).env?.VITE_BLOG_GUIDELINES_URL,
  };
}
