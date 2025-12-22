import { useEffect } from 'react';

/**
 * Interface for data received from parent application
 */
interface ParentDataPayload {
  userId?: string;
  accessToken?: string;
  userName?: string;
  blogMode?: string;
  timestamp?: string;
}

/**
 * Interface for postMessage event data
 */
interface ParentMessage {
  type: string;
  payload: ParentDataPayload;
  timestamp?: string;
}

/**
 * Custom hook to receive data from parent application via postMessage API
 * 
 * This hook listens for messages from the parent window, validates the origin,
 * and stores received data in localStorage. It also sends an acknowledgment
 * back to the parent when the child app is ready.
 * 
 * @param onDataReceived - Optional callback function called when data is received
 * 
 * @example
 * ```tsx
 * function App() {
 *   useParentData((data) => {
 *     console.log('Received from parent:', data);
 *   });
 *   // ...
 * }
 * ```
 */
export const useParentData = (onDataReceived?: (data: ParentDataPayload) => void) => {
  useEffect(() => {
    console.log('🚀 [PostMessage] useParentData hook mounted');
    
    const handleMessage = (event: MessageEvent) => {
      console.log('📨 [PostMessage] Message received from:', event.origin);
      console.log('   Message data:', event.data);
      
      // SECURITY: Validate the origin
      // In development, allow localhost:3000
      // In production, use the configured parent URL
      // @ts-ignore - Vite environment variables
      const parentUrl = import.meta.env?.VITE_PARENT_URL || 'http://localhost:3000';
      
      console.log('   Parent URL configured as:', parentUrl);
      
      // Extract origin from parent URL (handles both http://localhost:3000 and https://domain.com)
      let allowedOrigin: string;
      try {
        allowedOrigin = new URL(parentUrl).origin;
      } catch (e) {
        console.error('❌ [PostMessage] Invalid VITE_PARENT_URL:', parentUrl);
        allowedOrigin = 'http://localhost:3000';
      }

      // Allow both the configured origin and any localhost origin in development
      // @ts-ignore - Vite environment variables
      const isDevelopment = import.meta.env?.DEV || window.location.hostname === 'localhost';
      console.log('   Development mode:', isDevelopment);
      console.log('   Allowed origin:', allowedOrigin);
      console.log('   Event origin:', event.origin);
      
      const isValidOrigin = event.origin === allowedOrigin || 
                           (isDevelopment && event.origin.includes('localhost'));

      if (!isValidOrigin) {
        console.warn('⚠️  [PostMessage] Unauthorized origin:', event.origin);
        console.log('   Expected:', allowedOrigin);
        console.log('   isDevelopment:', isDevelopment);
        return;
      }
      
      console.log('✅ [PostMessage] Origin validated successfully');

      // Check if it's the expected message type
      const messageData = event.data as ParentMessage;
      
      console.log('   Message type:', messageData?.type);
      
      if (messageData?.type === 'PARENT_DATA') {
        const { payload } = messageData;
        
        console.log('✅ [PostMessage] Received PARENT_DATA message');
        console.log('   Payload:', payload);
        
        // Store data in localStorage
        if (payload.userId) {
          localStorage.setItem('userId', payload.userId);
          console.log('   ✓ Stored userId:', payload.userId);
        }
        if (payload.accessToken) {
          localStorage.setItem('accessToken', payload.accessToken);
          console.log('   ✓ Stored accessToken: [***' + payload.accessToken.slice(-4) + ']');
        }
        if (payload.userName) {
          localStorage.setItem('userName', payload.userName);
          console.log('   ✓ Stored userName:', payload.userName);
        }
        if (payload.blogMode) {
          localStorage.setItem('blogMode', payload.blogMode);
          console.log('   ✓ Stored blogMode:', payload.blogMode);
        }
        
        console.log('✅ [PostMessage] Data stored in localStorage successfully');
        console.log('   Verifying localStorage:');
        console.log('   - userId:', localStorage.getItem('userId'));
        console.log('   - accessToken:', localStorage.getItem('accessToken') ? '[SET]' : '[NOT SET]');
        console.log('   - userName:', localStorage.getItem('userName'));
        console.log('   - blogMode:', localStorage.getItem('blogMode'));
        
        // Trigger callback if provided
        if (onDataReceived) {
          onDataReceived(payload);
        }
      } else {
        console.log('   ℹ️  Message type is not PARENT_DATA, ignoring');
      }
    };

    // Add event listener
    window.addEventListener('message', handleMessage);
    
    // Notify parent that child is ready to receive messages
    // Use '*' as target origin since we're sending a non-sensitive ready signal
    console.log('📡 [PostMessage] Child app ready, notifying parent...');
    window.parent.postMessage({ type: 'CHILD_READY' }, '*');

    // Cleanup on unmount
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onDataReceived]);
};

/**
 * Utility function to send data back to parent application
 * 
 * @param data - Data to send to parent
 * @param targetOrigin - Target origin (defaults to VITE_PARENT_URL or localhost:3000)
 * 
 * @example
 * ```tsx
 * sendToParent({ status: 'ready', message: 'Blog created' });
 * ```
 */
export const sendToParent = (data: any, targetOrigin?: string) => {
  // @ts-ignore - Vite environment variables
  const parentUrl = targetOrigin || import.meta.env?.VITE_PARENT_URL || 'http://localhost:3000';
  
  try {
    const origin = new URL(parentUrl).origin;
    window.parent.postMessage({
      type: 'CHILD_RESPONSE',
      payload: data,
      timestamp: new Date().toISOString()
    }, origin);
    console.log('📤 [PostMessage] Sent data to parent:', data);
  } catch (e) {
    console.error('❌ [PostMessage] Failed to send data to parent:', e);
  }
};
