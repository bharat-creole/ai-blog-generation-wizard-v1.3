// server/middleware/auth.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request to include userId
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            userEmail?: string;
        }
    }
}

/**
 * Middleware to verify JWT token and extract user information
 */
export const authenticateToken = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            res.status(401).json({ error: 'Access token is required' });
            return;
        }

        // Verify token
        const jwtSecret = process.env.JWT_SECRET_KEY;
        if (!jwtSecret) {
            console.error('❌ [AUTH] JWT_SECRET_KEY is not set in environment variables');
            res.status(500).json({ error: 'Server configuration error' });
            return;
        }

        const decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string };

        // Attach user info to request
        req.userId = decoded.userId;
        req.userEmail = decoded.email;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        console.error('❌ [AUTH] Token verification error:', error);
        res.status(500).json({ error: 'Error verifying token' });
    }
};

/**
 * Optional middleware - doesn't fail if token is missing
 * Useful for endpoints that work with or without authentication
 */
export const optionalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const jwtSecret = process.env.JWT_SECRET_KEY;
            if (jwtSecret) {
                const decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string };
                req.userId = decoded.userId;
                req.userEmail = decoded.email;
            }
        }
    } catch (error) {
        // Silently fail for optional auth
        console.log('ℹ️  [AUTH] Optional auth failed, continuing without user info');
    }
    next();
};


