import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { storage } from '../storage';
import { getServerName } from '../db';
import type { BotInstance, InsertBotInstance } from '@shared/schema';

// Simple in-memory cache for replay protection (in production, use Redis)
const replayCache = new Map<string, number>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up expired entries from replay cache
setInterval(() => {
  const now = Date.now();
  // Fix TypeScript iteration issue by converting to array
  for (const [key, timestamp] of Array.from(replayCache.entries())) {
    if (now - timestamp > CACHE_TTL) {
      replayCache.delete(key);
    }
  }
}, 60000); // Clean every minute

interface CrossTenancyPayload {
  serverName: string;
  action: string;
  data: any;
  timestamp: number;
  nonce: string;
  idempotencyKey?: string;
}

interface CrossTenancyResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface BotCreateRequest {
  botData: InsertBotInstance;
  phoneNumber: string;
}

interface BotUpdateRequest {
  botId: string;
  updates: Partial<BotInstance>;
}

interface BotCredentialUpdateRequest {
  botId: string;
  credentialData: {
    credentialVerified: boolean;
    credentialPhone?: string;
    invalidReason?: string;
    credentials?: any;
  };
}

interface BotLifecycleRequest {
  botId: string;
  action: 'start' | 'stop' | 'restart';
}

export class CrossTenancyClient {
  private readonly currentServerName: string;

  constructor() {
    this.currentServerName = getServerName();
  }

  /**
   * Generate JWT token for server-to-server authentication
   */
  private generateToken(targetServerName: string, payload: CrossTenancyPayload, sharedSecret: string): string {
    const tokenPayload = {
      ...payload,
      iss: this.currentServerName, // issuer (source server)
      aud: targetServerName, // audience (target server)
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5 minute expiry
    };

    return jwt.sign(tokenPayload, sharedSecret, { algorithm: 'HS256' });
  }

  /**
   * Generate unique nonce for replay protection
   */
  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate idempotency key for request deduplication
   */
  private generateIdempotencyKey(action: string, identifier: string): string {
    return crypto.createHash('sha256')
      .update(`${this.currentServerName}-${action}-${identifier}-${Date.now()}`)
      .digest('hex');
  }

  /**
   * Make authenticated request to another server
   */
  private async makeRequest<T = any>(
    targetServerName: string,
    endpoint: string,
    payload: CrossTenancyPayload
  ): Promise<CrossTenancyResponse<T>> {
    try {
      // Get target server info
      const targetServer = await storage.getServerByName(targetServerName);
      if (!targetServer) {
        throw new Error(`Target server ${targetServerName} not found in registry`);
      }

      if (!targetServer.baseUrl) {
        throw new Error(`Target server ${targetServerName} has no baseUrl configured`);
      }

      if (!targetServer.sharedSecret) {
        throw new Error(`Target server ${targetServerName} has no sharedSecret configured`);
      }

      if (targetServer.serverStatus !== 'active') {
        throw new Error(`Target server ${targetServerName} is not active (status: ${targetServer.serverStatus})`);
      }

      // Generate authentication token
      const token = this.generateToken(targetServerName, payload, targetServer.sharedSecret);

      // Make HTTP request
      const url = `${targetServer.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Source-Server': this.currentServerName,
          'X-Target-Server': targetServerName,
          ...(payload.idempotencyKey && { 'X-Idempotency-Key': payload.idempotencyKey }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      return result;

    } catch (error) {
      console.error(`CrossTenancyClient: Request to ${targetServerName}${endpoint} failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a bot on another server
   */
  async createBot(targetServerName: string, botData: InsertBotInstance, phoneNumber: string): Promise<CrossTenancyResponse<BotInstance>> {
    const nonce = this.generateNonce();
    const idempotencyKey = this.generateIdempotencyKey('createBot', phoneNumber);

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: 'createBot',
      data: { botData, phoneNumber } as BotCreateRequest,
      timestamp: Date.now(),
      nonce,
      idempotencyKey,
    };

    console.log(`🌐 CrossTenancyClient: Creating bot on ${targetServerName} for phone ${phoneNumber}`);
    
    return await this.makeRequest<BotInstance>(targetServerName, '/internal/tenants/bots/create', payload);
  }

  /**
   * Update a bot on another server
   */
  async updateBot(targetServerName: string, botId: string, updates: Partial<BotInstance>): Promise<CrossTenancyResponse<BotInstance>> {
    const nonce = this.generateNonce();
    const idempotencyKey = this.generateIdempotencyKey('updateBot', botId);

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: 'updateBot',
      data: { botId, updates } as BotUpdateRequest,
      timestamp: Date.now(),
      nonce,
      idempotencyKey,
    };

    console.log(`🌐 CrossTenancyClient: Updating bot ${botId} on ${targetServerName}`);
    
    return await this.makeRequest<BotInstance>(targetServerName, '/internal/tenants/bots/update', payload);
  }

  /**
   * Update bot credentials on another server
   */
  async updateBotCredentials(
    targetServerName: string, 
    botId: string, 
    credentialData: {
      credentialVerified: boolean;
      credentialPhone?: string;
      invalidReason?: string;
      credentials?: any;
    }
  ): Promise<CrossTenancyResponse<BotInstance>> {
    const nonce = this.generateNonce();
    const idempotencyKey = this.generateIdempotencyKey('updateBotCredentials', botId);

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: 'updateBotCredentials',
      data: { botId, credentialData } as BotCredentialUpdateRequest,
      timestamp: Date.now(),
      nonce,
      idempotencyKey,
    };

    console.log(`🌐 CrossTenancyClient: Updating credentials for bot ${botId} on ${targetServerName}`);
    
    return await this.makeRequest<BotInstance>(targetServerName, '/internal/tenants/bots/credentials', payload);
  }

  /**
   * Control bot lifecycle on another server (start/stop/restart)
   */
  async controlBotLifecycle(
    targetServerName: string, 
    botId: string, 
    action: 'start' | 'stop' | 'restart'
  ): Promise<CrossTenancyResponse<{ status: string }>> {
    const nonce = this.generateNonce();
    const idempotencyKey = this.generateIdempotencyKey(`${action}Bot`, botId);

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: `${action}Bot`,
      data: { botId, action } as BotLifecycleRequest,
      timestamp: Date.now(),
      nonce,
      idempotencyKey,
    };

    console.log(`🌐 CrossTenancyClient: ${action} bot ${botId} on ${targetServerName}`);
    
    return await this.makeRequest<{ status: string }>(targetServerName, '/internal/tenants/bots/lifecycle', payload);
  }

  /**
   * Get bot status from another server
   */
  async getBotStatus(targetServerName: string, botId: string): Promise<CrossTenancyResponse<{ status: string; isOnline: boolean }>> {
    const nonce = this.generateNonce();

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: 'getBotStatus',
      data: { botId },
      timestamp: Date.now(),
      nonce,
    };

    console.log(`🌐 CrossTenancyClient: Getting status for bot ${botId} on ${targetServerName}`);
    
    return await this.makeRequest<{ status: string; isOnline: boolean }>(targetServerName, '/internal/tenants/bots/status', payload);
  }

  /**
   * Validate JWT token from another server (for incoming requests)
   */
  static validateToken(token: string, expectedSourceServer: string, sharedSecret: string): CrossTenancyPayload | null {
    try {
      const decoded = jwt.verify(token, sharedSecret) as any;
      
      // Validate token structure
      if (!decoded.iss || !decoded.aud || !decoded.serverName || !decoded.action) {
        console.error('CrossTenancyClient: Invalid token structure');
        return null;
      }

      // Validate issuer
      if (decoded.iss !== expectedSourceServer) {
        console.error(`CrossTenancyClient: Invalid issuer. Expected ${expectedSourceServer}, got ${decoded.iss}`);
        return null;
      }

      // Validate audience (should be current server)
      const currentServer = getServerName();
      if (decoded.aud !== currentServer) {
        console.error(`CrossTenancyClient: Invalid audience. Expected ${currentServer}, got ${decoded.aud}`);
        return null;
      }

      // Check replay attack protection
      const replayKey = `${decoded.serverName}-${decoded.nonce}`;
      if (replayCache.has(replayKey)) {
        console.error('CrossTenancyClient: Replay attack detected');
        return null;
      }

      // Add to replay cache
      replayCache.set(replayKey, Date.now());

      // Validate timestamp (must be within 5 minutes)
      const timestampAge = Date.now() - decoded.timestamp;
      if (timestampAge > CACHE_TTL || timestampAge < 0) {
        console.error('CrossTenancyClient: Token timestamp too old or in the future');
        return null;
      }

      return {
        serverName: decoded.serverName,
        action: decoded.action,
        data: decoded.data,
        timestamp: decoded.timestamp,
        nonce: decoded.nonce,
        idempotencyKey: decoded.idempotencyKey,
      };

    } catch (error) {
      console.error('CrossTenancyClient: Token validation failed:', error);
      return null;
    }
  }

  /**
   * Check if server is reachable and properly configured
   */
  async healthCheck(targetServerName: string): Promise<CrossTenancyResponse<{ status: string; version?: string }>> {
    const nonce = this.generateNonce();

    const payload: CrossTenancyPayload = {
      serverName: this.currentServerName,
      action: 'healthCheck',
      data: {},
      timestamp: Date.now(),
      nonce,
    };

    console.log(`🌐 CrossTenancyClient: Health check for ${targetServerName}`);
    
    return await this.makeRequest<{ status: string; version?: string }>(targetServerName, '/internal/tenants/health', payload);
  }
}

// Export singleton instance
export const crossTenancyClient = new CrossTenancyClient();