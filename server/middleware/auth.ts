import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { storage } from '../storage';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// In-memory guest session storage (phone: { otp, expires, verified, botId })
const guestSessions = new Map<string, {
  otp: string;
  expires: Date;
  verified: boolean;
  botId?: string;
  attempts: number;
}>();

export interface AuthRequest extends Request {
  user?: {
    username: string;
    isAdmin: boolean;
  };
  guest?: {
    phoneNumber: string;
    botId?: string;
    verified: boolean;
  };
}

export interface GuestAuthRequest extends Request {
  guest: {
    phoneNumber: string;
    botId: string;
    verified: boolean;
  };
}

export const authenticateAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authenticateUser = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const validateAdminCredentials = (username: string, password: string): boolean => {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  return username === adminUsername && password === adminPassword;
};

export const generateToken = (username: string, isAdmin: boolean): string => {
  return jwt.sign(
    { username, isAdmin },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Guest authentication functions
export const generateGuestOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const createGuestSession = (phoneNumber: string, otp: string): void => {
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  guestSessions.set(phoneNumber, {
    otp,
    expires,
    verified: false,
    attempts: 0
  });
};

export const verifyGuestOTP = (phoneNumber: string, providedOTP: string): boolean => {
  const session = guestSessions.get(phoneNumber);
  if (!session) return false;
  
  session.attempts++;
  
  // Max 3 attempts
  if (session.attempts > 3) {
    guestSessions.delete(phoneNumber);
    return false;
  }
  
  // Check expiry
  if (new Date() > session.expires) {
    guestSessions.delete(phoneNumber);
    return false;
  }
  
  // Check OTP
  if (session.otp === providedOTP) {
    session.verified = true;
    return true;
  }
  
  return false;
};

export const generateGuestToken = (phoneNumber: string, botId?: string): string => {
  return jwt.sign(
    { 
      phoneNumber, 
      botId,
      isGuest: true 
    },
    JWT_SECRET,
    { expiresIn: '2h' } // Shorter expiry for guest tokens
  );
};

export const getGuestSession = (phoneNumber: string) => {
  return guestSessions.get(phoneNumber);
};

export const setGuestBotId = (phoneNumber: string, botId: string): void => {
  const session = guestSessions.get(phoneNumber);
  if (session && session.verified) {
    session.botId = botId;
  }
};

export const clearGuestSession = (phoneNumber: string): void => {
  guestSessions.delete(phoneNumber);
};

// Guest authentication middleware
export const authenticateGuest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Guest authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (!decoded.isGuest || !decoded.phoneNumber) {
      return res.status(401).json({ error: 'Invalid guest token' });
    }
    
    // Check if guest session still exists and is verified
    const session = guestSessions.get(decoded.phoneNumber);
    if (!session || !session.verified) {
      return res.status(401).json({ error: 'Guest session expired or not verified' });
    }
    
    // If botId is required, verify it matches
    if (decoded.botId) {
      const botInstance = await storage.getBotInstance(decoded.botId);
      if (!botInstance || botInstance.phoneNumber !== decoded.phoneNumber) {
        return res.status(403).json({ error: 'Bot access denied - phone number mismatch' });
      }
    }
    
    req.guest = {
      phoneNumber: decoded.phoneNumber,
      botId: decoded.botId,
      verified: true
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid guest token' });
  }
};

// Strict guest authentication that requires a bot ID
export const authenticateGuestWithBot = async (req: GuestAuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Guest authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (!decoded.isGuest || !decoded.phoneNumber || !decoded.botId) {
      return res.status(401).json({ error: 'Invalid guest token - bot ID required' });
    }
    
    // Verify bot ownership
    const botInstance = await storage.getBotInstance(decoded.botId);
    if (!botInstance || botInstance.phoneNumber !== decoded.phoneNumber) {
      return res.status(403).json({ error: 'Bot access denied - you do not own this bot' });
    }
    
    // Check if guest session still exists and is verified
    const session = guestSessions.get(decoded.phoneNumber);
    if (!session || !session.verified) {
      return res.status(401).json({ error: 'Guest session expired or not verified' });
    }
    
    req.guest = {
      phoneNumber: decoded.phoneNumber,
      botId: decoded.botId,
      verified: true
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid guest token' });
  }
};