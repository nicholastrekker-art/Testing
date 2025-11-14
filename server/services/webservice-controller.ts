
import { Request, Response } from 'express';
import { storage } from '../storage';
import { botManager } from './bot-manager';
import { getServerName } from '../db';
import type { BotInstance, InsertBotInstance } from '@shared/schema';
import { decodeCredentials, validateBaileysCredentials } from './creds-validator';
import { crossTenancyClient } from './crossTenancyClient';
import { pairingService } from './pairing-service';

/**
 * WebService Controller - Pure function-based methods for all bot operations
 */
export class WebServiceController {
  
  /**
   * Get server information
   */
  async getServerInfo() {
    try {
      const { getServerNameWithFallback } = await import('../db');
      const serverName = await getServerNameWithFallback();
      const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
      const currentBots = await storage.getAllBotInstances();
      const hasSecretConfig = !!process.env.SERVER_NAME;

      return {
        success: true,
        data: {
          serverName,
          maxBots,
          currentBots: currentBots.length,
          availableSlots: maxBots - currentBots.length,
          hasSecretConfig
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch server info'
      };
    }
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats() {
    try {
      const stats = await storage.getDashboardStats();
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dashboard stats'
      };
    }
  }

  /**
   * Get all bot instances
   */
  async getAllBotInstances() {
    try {
      const bots = await storage.getAllBotInstances();
      return {
        success: true,
        data: bots
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bot instances'
      };
    }
  }

  /**
   * Get bot instance by ID
   */
  async getBotInstance(botId: string) {
    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return {
          success: false,
          error: 'Bot not found'
        };
      }
      return {
        success: true,
        data: bot
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bot instance'
      };
    }
  }

  /**
   * Start a bot
   */
  async startBot(botId: string) {
    try {
      await botManager.startBot(botId);
      
      await storage.createActivity({
        botInstanceId: botId,
        type: 'status_change',
        description: 'Bot started via webservice',
        serverName: getServerName()
      });

      return {
        success: true,
        message: 'Bot started successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start bot'
      };
    }
  }

  /**
   * Stop a bot
   */
  async stopBot(botId: string) {
    try {
      await botManager.stopBot(botId);
      
      await storage.updateBotInstance(botId, { status: 'offline' });
      
      await storage.createActivity({
        botInstanceId: botId,
        type: 'status_change',
        description: 'Bot stopped via webservice',
        serverName: getServerName()
      });

      return {
        success: true,
        message: 'Bot stopped successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop bot'
      };
    }
  }

  /**
   * Restart a bot
   */
  async restartBot(botId: string) {
    try {
      await botManager.restartBot(botId);
      
      await storage.createActivity({
        botInstanceId: botId,
        type: 'status_change',
        description: 'Bot restarted via webservice',
        serverName: getServerName()
      });

      return {
        success: true,
        message: 'Bot restarted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart bot'
      };
    }
  }

  /**
   * Generate WhatsApp pairing code
   */
  async generatePairingCode(phoneNumber: string) {
    try {
      const result = await pairingService.generatePairingCode(phoneNumber);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to generate pairing code'
        };
      }

      return {
        success: true,
        data: {
          code: result.code,
          requestId: result.requestId,
          phoneNumber: result.phoneNumber
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate pairing code'
      };
    }
  }

  /**
   * Check guest session by phone number
   */
  async getGuestSession(phoneNumber: string) {
    try {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      const session = await storage.getGuestSessionByPhone(cleanedPhone);
      
      if (!session || !session.sessionId) {
        return {
          success: true,
          found: false,
          message: 'No session found for this phone number'
        };
      }

      return {
        success: true,
        found: true,
        sessionId: session.sessionId,
        message: 'Session found'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve session'
      };
    }
  }

  /**
   * Validate credentials
   */
  async validateCredentials(credentials: any, phoneNumber?: string) {
    try {
      let normalizedCreds = credentials;
      const isV7Format = credentials.noiseKey && credentials.signedIdentityKey && !credentials.creds;

      if (isV7Format) {
        normalizedCreds = {
          creds: credentials,
          keys: {}
        };
      }

      if (!normalizedCreds.creds || typeof normalizedCreds.creds !== 'object') {
        return {
          success: false,
          valid: false,
          message: '❌ Invalid credentials format'
        };
      }

      const requiredFields = ['noiseKey', 'signedIdentityKey', 'signedPreKey', 'registrationId'];
      const missingFields = [];
      
      for (const field of requiredFields) {
        if (!normalizedCreds.creds[field]) {
          missingFields.push(`creds.${field}`);
        }
      }

      if (missingFields.length > 0) {
        return {
          success: false,
          valid: false,
          message: `❌ Missing required fields: ${missingFields.join(', ')}`
        };
      }

      if (phoneNumber && normalizedCreds.creds?.me?.id) {
        const credentialsPhone = normalizedCreds.creds.me.id.match(/^(\d+):/)?.[1];
        const providedPhoneNormalized = phoneNumber.replace(/\D/g, '');

        if (credentialsPhone && providedPhoneNormalized) {
          if (credentialsPhone !== providedPhoneNormalized) {
            return {
              success: false,
              valid: false,
              message: `❌ Phone number mismatch. Credentials belong to +${credentialsPhone} but you provided +${providedPhoneNormalized}`
            };
          }
        }
      }

      const { validateCredentialsByPhoneNumber } = await import('./creds-validator');
      const phoneValidation = await validateCredentialsByPhoneNumber(normalizedCreds);

      if (!phoneValidation.isValid) {
        return {
          success: false,
          valid: false,
          message: phoneValidation.message,
          isDuplicate: true
        };
      }

      return {
        success: true,
        valid: true,
        message: '✅ Credentials are valid and ready for registration',
        phoneNumber: phoneValidation.phoneNumber,
        isUnique: true
      };
    } catch (error) {
      return {
        success: false,
        valid: false,
        error: error instanceof Error ? error.message : 'Failed to validate credentials'
      };
    }
  }

  /**
   * Check phone registration status
   */
  async checkRegistration(phoneNumber: string) {
    try {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      
      if (!globalRegistration) {
        return {
          success: true,
          registered: false,
          message: 'Phone number not registered'
        };
      }

      const hostingServer = globalRegistration.tenancyName;
      const isCurrentServer = hostingServer === currentServer;

      if (isCurrentServer) {
        const bot = await storage.getBotByPhoneNumber(cleanedPhone);
        
        return {
          success: true,
          registered: true,
          currentServer: true,
          hasBot: !!bot,
          bot: bot || null,
          registeredTo: hostingServer
        };
      } else {
        return {
          success: true,
          registered: true,
          currentServer: false,
          serverMismatch: true,
          registeredTo: hostingServer,
          message: `This phone number is registered on ${hostingServer}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check registration'
      };
    }
  }

  /**
   * Register a new bot (guest registration)
   */
  async registerBot(data: {
    botName: string;
    phoneNumber: string;
    sessionId: string;
    features: any;
    selectedServer?: string;
  }) {
    try {
      const cleanedPhone = data.phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();
      const targetServer = data.selectedServer || currentServer;

      // Decode and validate credentials
      let credentials;
      try {
        let sessionId = data.sessionId;
        if (sessionId.startsWith('TREKKER~')) {
          sessionId = sessionId.substring(8);
        }
        const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
        credentials = JSON.parse(decoded);
      } catch (error) {
        return {
          success: false,
          error: 'Invalid session ID format'
        };
      }

      // Check if bot exists
      const existingBot = await storage.getBotByPhoneNumber(cleanedPhone);
      
      if (existingBot) {
        return {
          success: true,
          type: 'existing_bot_found',
          botDetails: existingBot,
          message: 'Bot already exists for this phone number'
        };
      }

      // Create bot instance
      const botData: InsertBotInstance = {
        name: data.botName,
        phoneNumber: cleanedPhone,
        credentials: JSON.stringify(credentials),
        approvalStatus: 'pending',
        status: 'offline',
        serverName: targetServer,
        isGuest: true,
        autoLike: data.features.autoLike || false,
        autoReact: data.features.autoReact || false,
        autoViewStatus: data.features.autoView || false,
        chatgptEnabled: data.features.chatGPT || false,
        presenceMode: data.features.presenceMode || 'none'
      };

      const bot = await storage.createBotInstance(botData);

      // Register in God Registry
      await storage.registerPhoneGlobally(cleanedPhone, targetServer);

      await storage.createActivity({
        botInstanceId: bot.id,
        type: 'creation',
        description: 'Bot registered via webservice',
        serverName: targetServer
      });

      return {
        success: true,
        type: 'new_registration',
        botDetails: bot,
        message: 'Bot registered successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register bot'
      };
    }
  }

  /**
   * Get offer status
   */
  async getOfferStatus() {
    try {
      const config = await storage.getOfferConfig();
      const isActive = await storage.isOfferActive();
      const timeRemaining = await storage.getOfferTimeRemaining();

      return {
        success: true,
        data: {
          isActive,
          config,
          timeRemaining
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch offer status'
      };
    }
  }

  /**
   * Get available servers
   */
  async getAvailableServers() {
    try {
      const servers = await storage.getAvailableServers();
      
      return {
        success: true,
        data: {
          servers: servers.map(s => ({
            id: s.serverName,
            name: s.serverName,
            description: s.description || `Server ${s.serverName}`,
            currentBots: s.currentBotCount || 0,
            maxBots: s.maxBotCount,
            availableSlots: s.maxBotCount - (s.currentBotCount || 0)
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch available servers'
      };
    }
  }

  /**
   * Get all activities
   */
  async getActivities(limit: number = 50) {
    try {
      const activities = await storage.getRecentActivities(limit);
      return {
        success: true,
        data: activities
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch activities'
      };
    }
  }
}

// Export singleton instance
export const webServiceController = new WebServiceController();
