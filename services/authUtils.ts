// services/authUtils.ts

/**
 * Get JWT token from localStorage
 * Token is typically stored after login
 */
export function getAuthToken(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    
    // Try common token storage keys (check accessToken first since that's what we're storing)
    const token = 
        localStorage.getItem('accessToken') ||
        localStorage.getItem('token') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('jwtToken');
    
    if (token) {
        console.log('✅ [AuthUtils] Token found in localStorage');
    } else {
        console.warn('⚠️  [AuthUtils] No token found in localStorage');
        console.log('   Checked keys: accessToken, token, authToken, jwtToken');
    }
    
    return token;
}

/**
 * Get headers with authentication token
 */
export function getAuthHeaders(): HeadersInit {
    const token = getAuthToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log('✅ [AuthUtils] Authorization header added');
    } else {
        console.warn('⚠️  [AuthUtils] No token available, request will fail authentication');
    }
    
    return headers;
}

