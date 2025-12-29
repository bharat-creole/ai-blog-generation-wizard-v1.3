/**
 * PostHog Analytics Service
 * 
 * This service provides helper functions to interact with PostHog analytics.
 * PostHog is loaded via script tag in index.html and available as window.posthog
 */

// TypeScript declaration for window.posthog
declare global {
  interface Window {
    posthog?: any;
  }
}

// Helper function to track custom events
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture(eventName, properties);
  } else {
    console.warn('PostHog not initialized. Event not tracked:', eventName);
  }
};

// Helper function to identify users
export const identifyUser = (userId: string, userProperties?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.identify(userId, userProperties);
  } else {
    console.warn('PostHog not initialized. User not identified:', userId);
  }
};

// Helper function to reset user (on logout)
export const resetUser = () => {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.reset();
  } else {
    console.warn('PostHog not initialized. Cannot reset user.');
  }
};

// Export the posthog instance for direct access if needed
export const posthog = typeof window !== 'undefined' ? window.posthog : undefined;

