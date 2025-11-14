
import { Request, Response } from 'express';
import { storage } from '../storage';
import { botManager } from './bot-manager';
import { getServerName } from '../db';
import type { BotInstance, InsertBotInstance } from '@shared/schema';
import { decodeCredentials, validateBaileysCredentials } from './creds-validator';
import { crossTenancyClient } from './crossTenancyClient';

/**
 * WebService Controller - Refactored route handlers as reusable methods
 * This allows HTTP requests to be handled through functions instead of direct Express routes
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
   * Get all bot instances (admin)
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
   * Validate credentials
   */
  async validateCredentials(credentials: any, phoneNumber?: string) {
    try {
      // Normalize credentials format
      let normalizedCreds = credentials;
      const isV7Format = credentials.noiseKey && credentials.signedIdentityKey && !credentials.creds;

      if (isV7Format) {
        normalizedCreds = {
          creds: credentials,
          keys: {}
        };
      }

      // Validate structure
      if (!normalizedCreds.creds || typeof normalizedCreds.creds !== 'object') {
        return {
          success: false,
          valid: false,
          message: '❌ Invalid credentials format'
        };
      }

      // Check required fields
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

      // Validate phone number ownership if provided
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

      // Check for duplicates
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
   * Create bot instance
   */
  async createBotInstance(botData: InsertBotInstance) {
    try {
      // Check server capacity
      const serverName = getServerName();
      const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
      const currentBots = await storage.getAllBotInstances();

      if (currentBots.length >= maxBots) {
        return {
          success: false,
          error: `Server at capacity (${maxBots} bots maximum)`
        };
      }

      // Create bot
      const bot = await storage.createBotInstance(botData);

      await storage.createActivity({
        botInstanceId: bot.id,
        type: 'creation',
        description: 'Bot created via webservice',
        serverName
      });

      return {
        success: true,
        data: bot,
        message: 'Bot created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create bot'
      };
    }
  }

  /**
   * Update bot instance
   */
  async updateBotInstance(botId: string, updates: Partial<BotInstance>) {
    try {
      await storage.updateBotInstance(botId, updates);
      
      const bot = await storage.getBotInstance(botId);
      
      await storage.createActivity({
        botInstanceId: botId,
        type: 'update',
        description: 'Bot updated via webservice',
        serverName: getServerName()
      });

      return {
        success: true,
        data: bot,
        message: 'Bot updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update bot'
      };
    }
  }

  /**
   * Delete bot instance
   */
  async deleteBotInstance(botId: string) {
    try {
      // Stop bot first if running
      await botManager.deleteBot(botId);
      
      // Delete from database
      await storage.deleteBotInstance(botId);

      return {
        success: true,
        message: 'Bot deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete bot'
      };
    }
  }

  /**
   * Get bot status
   */
  async getBotStatus(botId: string) {
    try {
      const status = botManager.getBotStatus(botId);
      const bot = await storage.getBotInstance(botId);

      return {
        success: true,
        data: {
          botId,
          status,
          isOnline: status === 'online',
          botDetails: bot
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get bot status'
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
