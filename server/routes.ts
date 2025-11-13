import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from 'jsonwebtoken';
import multer from "multer";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { storage } from "./storage";

// ES Module __dirname and __filename equivalents
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { insertBotInstanceSchema, insertCommandSchema, insertActivitySchema, botInstances, guestSessions } from "@shared/schema";
import { botManager } from "./services/bot-manager";
import { getServerName, db } from "./db";
import { and, eq, desc, asc, isNotNull, sql } from "drizzle-orm";
import {
  authenticateAdmin,
  authenticateUser,
  authenticateGuest,
  authenticateGuestWithBot,
  validateAdminCredentials,
  generateToken,
  generateGuestOTP,
  createGuestSession,
  verifyGuestOTP,
  generateGuestToken,
  setGuestBotId,
  clearGuestSession,
  type AuthRequest,
  type GuestAuthRequest
} from './middleware/auth';
import { decodeCredentials, validateBaileysCredentials, extractPhoneNumber } from './services/creds-validator';

// Helper function to check if user is admin (for middleware-less routes)
const isAdmin = (req: any, res: any, next: any) => {
  return authenticateAdmin(req as AuthRequest, res, next);
};
import { sendValidationMessage, sendGuestValidationMessage, validateWhatsAppCredentials } from "./services/validation-bot";
import { CrossTenancyClient } from "./services/crossTenancyClient";
import { z } from "zod";
import crypto from 'crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';
import express from 'express'; // Import express

// Helper function to resolve bot location by phone number across tenancies
async function resolveBotByPhone(phoneNumber: string): Promise<{
  bot: any;
  isLocal: boolean;
  serverName: string;
  canManage: boolean;
  needsProxy: boolean;
}> {
  const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
  const currentServer = getServerName();

  // Check God Registry to find hosting server
  const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
  if (!globalRegistration) {
    throw new Error("No bot found with this phone number");
  }

  const hostingServer = globalRegistration.tenancyName;
  const isLocal = hostingServer === currentServer;

  if (isLocal) {
    // Bot is on current server
    const bot = await storage.getBotByPhoneNumber(cleanedPhone);
    if (!bot) {
      throw new Error("Bot found in registry but not in local database");
    }

    const canManage = enforceGuestPermissions(bot);
    return {
      bot,
      isLocal: true,
      serverName: hostingServer,
      canManage,
      needsProxy: false
    };
  } else {
    // Bot is on remote server - create basic bot info from registry
    // For cross-server bots, we'll use minimal info and rely on proxy for actions
    const remoteBot = {
      id: `remote-${cleanedPhone}`,
      name: `Bot (${cleanedPhone})`,
      phoneNumber: cleanedPhone,
      status: "cross-server",
      approvalStatus: "unknown", // Will need validation to get real status
      messagesCount: 0,
      commandsCount: 0,
      lastActivity: null
    };

    // For cross-server bots, assume they need credential validation to determine real permissions
    const canManage = false; // Will be determined after credential validation
    return {
      bot: remoteBot,
      isLocal: false,
      serverName: hostingServer,
      canManage,
      needsProxy: true
    };
  }
}

// Helper function to resolve bot by ID with tenancy support
async function resolveBotById(botId: string, phoneNumber?: string): Promise<{
  bot: any;
  isLocal: boolean;
  serverName: string;
  canManage: boolean;
  needsProxy: boolean;
}> {
  const currentServer = getServerName();

  // First try local lookup
  try {
    const localBot = await storage.getBotInstance(botId);
    if (localBot && (!phoneNumber || localBot.phoneNumber === phoneNumber)) {
      const canManage = enforceGuestPermissions(localBot);
      return {
        bot: localBot,
        isLocal: true,
        serverName: currentServer,
        canManage,
        needsProxy: false
      };
    }
  } catch (error) {
    // Bot not found locally, continue to cross-tenancy search
  }

  // If not found locally and phone number provided, use phone-based resolution
  if (phoneNumber) {
    return await resolveBotByPhone(phoneNumber);
  }

  throw new Error("Bot not found on any server");
}

// Helper function to enforce guest permissions based on bot approval status
function enforceGuestPermissions(bot: any): boolean {
  if (!bot) return false;

  // Only approved bots can be managed (start/stop/restart)
  // All bots (including pending/dormant) can have credentials updated
  return bot.approvalStatus === 'approved';
}

// Helper function to validate guest action permissions
function validateGuestAction(action: string, bot: any): { allowed: boolean; reason?: string } {
  if (!bot) {
    return { allowed: false, reason: "Bot not found" };
  }

  const isApproved = bot.approvalStatus === 'approved';

  switch (action) {
    case 'start':
    case 'stop':
    case 'restart':
      if (!isApproved) {
        return {
          allowed: false,
          reason: "Only approved bots can be started, stopped, or restarted. Pending bots must be approved by admin first."
        };
      }
      return { allowed: true };

    case 'update_credentials':
      // All bots can have credentials updated
      return { allowed: true };

    default:
      return { allowed: false, reason: "Unknown action" };
  }
}

// Helper function to send WhatsApp notification to bot owner
async function sendBotManagerNotification(ownerJid: string, phoneNumber: string): Promise<void> {
  try {
    console.log(`📱 Sending bot manager notification to ${ownerJid} for phone ${phoneNumber}`);

    // Create a temporary validation bot to send the notification
    const { ValidationBot } = await import('./services/validation-bot');
    const notificationBot = new ValidationBot(phoneNumber);

    // Connect and send notification message
    const connected = await notificationBot.connect();
    if (connected) {
      const message = `🤖 *Bot Manager Access*\n\nYou have successfully connected to the bot manager for *${phoneNumber}*.\n\n✅ Connection established\n⏱️ Valid for 24 hours\n🔧 Manage your bot features remotely\n\n_This is a temporary connection for bot management._`;

      await notificationBot.sendMessage(ownerJid, message);
      console.log(`✅ Bot manager notification sent to ${ownerJid}`);

      // Record notification sent
      const connection = await storage.getExternalBotConnection(phoneNumber);
      if (connection) {
        await storage.updateExternalBotConnection(connection.id, {
          notificationSentAt: new Date()
        });
      }
    }

    // Clean disconnect preserving credentials
    await notificationBot.disconnect(true);

  } catch (error) {
    console.error(`❌ Failed to send bot manager notification to ${ownerJid}:`, error);
    // Don't throw error to avoid breaking the main flow
  }
}

// Data masking utility for guest-facing APIs - hides sensitive information
function maskBotDataForGuest(botData: any, includeFeatures: boolean = false): any {
  if (!botData) return null;

  const masked = {
    // Keep essential identifiers (use phone number as public ID)
    id: `bot_${botData.phoneNumber.slice(-4)}`, // Masked ID using last 4 digits
    botId: botData.id, // Include original botId for API compatibility
    name: botData.name,
    phoneNumber: botData.phoneNumber,

    // Basic status information (safe to expose)
    status: botData.status,
    approvalStatus: botData.approvalStatus,
    isActive: botData.status === 'online',
    isApproved: botData.approvalStatus === 'approved',

    // Pass through isOnline if provided (for API compatibility)
    ...(botData.hasOwnProperty('isOnline') && { isOnline: botData.isOnline }),

    // Enhanced credential management fields
    credentialVerified: botData.credentialVerified || false,
    invalidReason: botData.invalidReason,
    nextStep: botData.nextStep,
    message: botData.message,
    autoStart: botData.autoStart ?? true,
    needsCredentials: botData.needsCredentials || false,
    canManage: botData.canManage || false,
    credentialUploadEndpoint: botData.credentialUploadEndpoint,

    // Limited stats (counts only, no detailed activity)
    messagesCount: Math.min(botData.messagesCount || 0, 9999), // Cap at 9999 for privacy
    commandsCount: Math.min(botData.commandsCount || 0, 9999), // Cap at 9999 for privacy
    lastActivity: botData.lastActivity ? new Date(botData.lastActivity).toISOString().split('T')[0] : null, // Date only, no time

    // Cross-server information (SECURITY FIX: Always mask server names)
    crossServer: botData.crossServer || false,
    serverName: 'Protected', // Always mask server names to prevent tenant isolation breaches

    // Optional: Basic feature status (simplified)
    ...(includeFeatures && {
      features: {
        chatEnabled: !!(botData.chatgptEnabled || botData.autoReact),
        automationEnabled: !!(botData.autoLike || botData.autoViewStatus),
        // Don't expose specific feature configs
      }
    })
  };

  // Remove undefined values
  return Object.fromEntries(Object.entries(masked).filter(([_, v]) => v !== undefined));
}

const upload = multer({
  storage:multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// REMOVED: Dangerous resetToDefaultServerAfterRegistration function
// This function was causing downtime by stopping all bots unnecessarily.
// Cross-server registrations now work properly without server context switching.

export async function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // WebSocket server setup
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
    });
  });

  // Broadcast function for real-time updates
  const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  };

  // Set broadcast function in bot manager
  botManager.setBroadcastFunction(broadcast);

  // Serve pair.html and integrate pairing router
  const pairPublicPath = path.join(__dirname, '..', 'pair', 'public');
  app.use('/pair', express.static(pairPublicPath));

  // Import and mount pairing routes
  const pairRouter = await import('../pair/routers/pair.js');
  app.use('/api/pair', pairRouter.default);

  // Function to resume all saved bots from database on startup
  async function resumeSavedBots() {
    try {
      console.log('🔄 Starting bot resume process...');

      // Analyze inactive bots and update their auto-start status
      await storage.analyzeInactiveBots();

      // Get all approved bots (regardless of autoStart flag)
      const approvedBots = await storage.getApprovedBots();

      // Filter for bots with verified credentials or no credential requirement
      const resumableBots = approvedBots.filter(bot => {
        // Start if credentials are verified OR if credentials haven't been set yet (backward compatibility)
        return bot.credentialVerified === true || bot.credentials === null || bot.credentials === undefined;
      });

      if (resumableBots.length === 0) {
        console.log('📋 No approved bots found for auto-start');
        return;
      }

      console.log(`🚀 Resuming ${resumableBots.length} approved bot(s)...`);

      // Set all bots to loading status initially
      for (const bot of resumableBots) {
        await storage.updateBotInstance(bot.id, { status: 'loading' });
        await storage.createActivity({
          botInstanceId: bot.id,
          type: 'startup',
          description: 'Bot resume initiated on server restart',
          serverName: getServerName()
        });
      }

      // Resume bots with a delay between each to prevent overwhelming
      for (let i = 0; i < resumableBots.length; i++) {
        const bot = resumableBots[i];

        setTimeout(async () => {
          try {
            console.log(`🔄 Resuming bot: ${bot.name} (${bot.id})`);

            // Create and start the bot
            await botManager.createBot(bot.id, bot);
            await botManager.startBot(bot.id);

            console.log(`✅ Bot ${bot.name} resumed successfully`);

            await storage.createActivity({
              botInstanceId: bot.id,
              type: 'startup',
              description: 'Bot resumed successfully on server restart',
              serverName: getServerName()
            });

            // Broadcast bot status update
            broadcast({
              type: 'BOT_RESUMED',
              data: {
                botId: bot.id,
                name: bot.name,
                status: 'loading'
              }
            });

          } catch (error) {
            console.error(`❌ Failed to resume bot ${bot.name}:`, error);

            await storage.updateBotInstance(bot.id, { status: 'error' });
            await storage.createActivity({
              botInstanceId: bot.id,
              type: 'error',
              description: `Bot resume failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              serverName: getServerName()
            });

            // Broadcast bot error
            broadcast({
              type: 'BOT_ERROR',
              data: {
                botId: bot.id,
                name: bot.name,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
              }
            });
          }
        }, i * 2000); // 2 second delay between each bot
      }

      console.log(`✅ Bot resume process initiated for ${resumableBots.length} bot(s)`);

    } catch (error) {
      console.error('❌ Failed to resume saved bots:', error);
    }
  }

  // Resume all saved bots from database on startup (non-blocking)
  resumeSavedBots().catch(error => {
    console.error('❌ Critical error in bot resume process:', error);
  });

  // Auth endpoints
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const isValidAdmin = validateAdminCredentials(username, password);

      if (isValidAdmin) {
        const token = generateToken(username, true);
        res.json({
          token,
          user: { username, isAdmin: true },
          message: "Admin login successful"
        });
      } else {
        res.status(401).json({ message: "Invalid credentials" });
      }
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/auth/verify", authenticateUser, (req: AuthRequest, res) => {
    res.json({ user: req.user });
  });

  // Credentials validation endpoint (accessible to everyone) - handles both JSON and multipart
  const multipartOnly = (req: any, res: any, next: any) => {
    return req.is('multipart/form-data') ? upload.single('credentials')(req, res, next) : next();
  };

  app.post("/api/validate-credentials", multipartOnly, async (req, res) => {
    try {
      let credentials;
      let credentialType = 'file'; // Default to file

      // Handle Base64 session data
      if (req.body.sessionData) {
        credentialType = 'base64';
        try {
          let base64Data = req.body.sessionData.trim();

          // Remove TREKKER~ prefix if present
          if (base64Data.startsWith('TREKKER~')) {
            console.log('🔧 Removing TREKKER~ prefix from session ID');
            base64Data = base64Data.substring(8); // Remove 'TREKKER~' (8 characters)
          }

          // Check Base64 size limit (5MB when decoded)
          const estimatedSize = (base64Data.length * 3) / 4; // Rough estimate of decoded size
          const maxSizeBytes = 5 * 1024 * 1024; // 5MB

          if (estimatedSize > maxSizeBytes) {
            return res.status(400).json({
              message: `❌ Base64 session data too large (estimated ${(estimatedSize / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.`
            });
          }

          const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');

          // Check actual decoded size
          if (decoded.length > maxSizeBytes) {
            return res.status(400).json({
              message: `❌ Decoded session data too large (${(decoded.length / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.`
            });
          }

          credentials = JSON.parse(decoded);
        } catch (error) {
          return res.status(400).json({
            message: "❌ Invalid Base64 session data. Please ensure it's properly encoded WhatsApp session data."
          });
        }
      }
      // Handle file upload
      else if (req.file) {
        try {
          credentials = JSON.parse(req.file.buffer.toString());
        } catch (error) {
          return res.status(400).json({
            message: "❌ Invalid JSON file. Please ensure you're uploading a valid credentials.json file."
          });
        }
      } else {
        return res.status(400).json({
          message: "Please provide credentials either as a file upload or Base64 session data"
        });
      }

      // Basic validation of credentials structure
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
        return res.status(400).json({
          message: "❌ Invalid credentials format. Please upload a valid WhatsApp session file."
        });
      }

      // Detect and normalize v7 format (fields at root) to expected format (wrapped in creds)
      const isV7Format = credentials.noiseKey && credentials.signedIdentityKey && !credentials.creds;

      if (isV7Format) {
        console.log('🔧 Detected Baileys v7 format credentials, wrapping in creds object');
        credentials = {
          creds: credentials,
          keys: {}
        };
      }

      // Check required fields for WhatsApp credentials
      const missingFields = [];

      // Check top-level creds object
      if (!credentials.creds || typeof credentials.creds !== 'object') {
        missingFields.push('creds');
      } else {
        // Check nested fields inside credentials.creds
        const requiredNestedFields = ['noiseKey', 'signedIdentityKey', 'signedPreKey', 'registrationId'];
        for (const field of requiredNestedFields) {
          if (!credentials.creds[field]) {
            missingFields.push(`creds.${field}`);
          }
        }
      }

      if (missingFields.length > 0) {
        return res.status(400).json({
          message: `❌ Missing required fields in credentials: ${missingFields.join(', ')}. Please ensure you're using a complete WhatsApp session file with proper nested structure.`
        });
      }

      // Validate phone number ownership if provided
      const phoneNumber = req.body.phoneNumber;
      if (phoneNumber && credentials.creds?.me?.id) {
        const credentialsPhone = credentials.creds.me.id.match(/^(\d+):/)?.[1];
        const providedPhoneNormalized = phoneNumber.replace(/\D/g, '');

        if (credentialsPhone && providedPhoneNormalized) {
          if (credentialsPhone !== providedPhoneNormalized) {
            return res.status(400).json({
              message: `❌ Phone number mismatch. The credentials belong to +${credentialsPhone} but you provided +${providedPhoneNormalized}. Please use the correct credentials for your phone number.`
            });
          }
        }
      }

      // Check file size (for file uploads)
      if (credentialType === 'file' && req.file) {
        const fileSizeKB = req.file.buffer.length / 1024;
        if (fileSizeKB < 0.01 || fileSizeKB > 5120) { // 10 bytes to 5MB
          return res.status(400).json({
            message: `❌ Invalid file size (${fileSizeKB.toFixed(2)} KB). Credentials file should be between 10 bytes and 5MB.`
          });
        }
      }

      // Check if phone number from credentials already exists in database (cross-server search)
      const { validateCredentialsByPhoneNumber } = await import('./services/creds-validator');
      const phoneValidation = await validateCredentialsByPhoneNumber(credentials);

      if (!phoneValidation.isValid) {
        return res.status(400).json({
          valid: false,
          message: phoneValidation.message,
          phoneNumber: phoneValidation.phoneNumber,
          alreadyRegistered: phoneValidation.alreadyRegistered,
          isDuplicate: true
        });
      }

      // All validations passed
      res.json({
        valid: true,
        message: phoneValidation.message || "✅ Your credentials are valid and ready for registration!",
        credentialType,
        phoneNumber: phoneValidation.phoneNumber,
        isUnique: true
      });

    } catch (error) {
      console.error('Credentials validation error:', error);
      res.status(500).json({
        valid: false,
        message: "Failed to validate credentials. Please try again.",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Server info
  app.get("/api/server/info", async (req, res) => {
    try {
      const { getServerNameWithFallback } = await import('./db');
      const serverName = await getServerNameWithFallback();
      const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
      const currentBots = await storage.getAllBotInstances();
      const hasSecretConfig = !!process.env.SERVER_NAME;

      res.json({
        serverName,
        maxBots,
        currentBots: currentBots.length,
        availableSlots: maxBots - currentBots.length,
        hasSecretConfig
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch server info" });
    }
  });

  // Get all available servers (Server1 to Server100) with bot counts
  app.get("/api/servers/list", async (req, res) => {
    try {
      const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
      const serverList = [];

      // Generate Server1 to Server100 list
      for (let i = 1; i <= 100; i++) {
        const serverName = `Server${i}`;

        // Check if server exists in registry
        const serverInfo = await storage.getServerByName(serverName);

        if (serverInfo) {
          // Server exists, use actual data
          serverList.push({
            name: serverName,
            totalBots: serverInfo.maxBotCount,
            currentBots: serverInfo.currentBotCount || 0,
            remainingBots: serverInfo.maxBotCount - (serverInfo.currentBotCount || 0),
            description: serverInfo.description,
            status: serverInfo.serverStatus
          });
        } else {
          // Server doesn't exist yet, show as available
          serverList.push({
            name: serverName,
            totalBots: maxBots,
            currentBots: 0,
            remainingBots: maxBots,
            description: null,
            status: 'available'
          });
        }
      }

      // Sort by current bots (ascending) - empty servers first
      serverList.sort((a, b) => {
        const aCurrent = a.currentBots || 0;
        const bCurrent = b.currentBots || 0;
        if (aCurrent !== bCurrent) {
          return aCurrent - bCurrent;
        }
        // If same bot count, sort by name
        return a.name.localeCompare(b.name);
      });

      res.json(serverList);
    } catch (error) {
      console.error("Server list error:", error);
      res.status(500).json({ message: "Failed to fetch server list" });
    }
  });


  // Update server configuration (name and description) - implements true tenant switching
  app.post("/api/server/configure", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      // Only allow configuration if SERVER_NAME is not set via secrets
      if (process.env.SERVER_NAME) {
        return res.status(400).json({
          message: "Server name is configured via secrets and cannot be changed through UI"
        });
      }

      const { serverName, description } = req.body;

      if (!serverName || serverName.trim().length === 0) {
        return res.status(400).json({ message: "Server name is required" });
      }

      const { getServerName } = await import('./db');
      const currentServerName = getServerName();
      const newServerName = serverName.trim();

      // If server name is the same, just update description
      if (currentServerName === newServerName) {
        const currentServer = await storage.getServerByName(currentServerName);
        if (currentServer) {
          await storage.updateServerInfo(currentServerName, {
            serverName: newServerName,
            description: description?.trim() || null
          });
        }
        return res.json({ message: "Server description updated successfully" });
      }

      // FIXED: Server information update WITHOUT changing global server tenancy
      console.log(`📝 Updating server information for "${newServerName}" without changing current tenancy`);

      // Step 1: Ensure target server exists in registry (create if needed)
      let targetServer = await storage.getServerByName(newServerName);
      if (!targetServer) {
        const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
        targetServer = await storage.createServer({
          serverName: newServerName,
          maxBotCount: maxBots,
          currentBotCount: 0,
          serverStatus: 'active',
          description: description?.trim() || `Server ${newServerName}`
        });
        console.log(`✅ Created new server tenant: ${newServerName} (without switching)`);
      } else if (description?.trim()) {
        // Update description if provided
        await storage.updateServerInfo(newServerName, {
          serverName: newServerName,
          description: description.trim()
        });
      }

      // SECURITY FIX: Do NOT change global server context or restart bots
      // This maintains proper tenant isolation while allowing server management
      console.log(`✅ Server information updated without changing tenancy context`);

      // Log the configuration activity for audit trail
      await storage.createActivity({
        botInstanceId: 'server-config',
        type: 'server_configuration',
        description: `Server ${newServerName} configuration updated from ${currentServerName}`,
        metadata: {
          targetServer: newServerName,
          sourceServer: currentServerName,
          description: description?.trim(),
          tenancyChangeBlocked: true,
          reason: 'Cross-tenancy management security'
        },
        serverName: currentServerName
      });

      res.json({
        message: "Server information updated successfully without changing tenancy context.",
        serverName: newServerName,
        description: description?.trim(),
        crossTenancyMode: true,
        tenancyChangeBlocked: true
      });

    } catch (error) {
      console.error("Server configuration error:", error);
      res.status(500).json({ message: "Failed to update server configuration" });
    }
  });

  // Helper function to initialize server tenant
  async function initializeServerTenant(serverName: string) {
    console.log(`🔧 Initializing tenant for server: ${serverName}`);

    // Update bot count for the new server based on actual database data
    const actualBots = await storage.getBotInstancesForServer(serverName);
    await storage.updateServerBotCount(serverName, actualBots.length);

    console.log(`✅ Tenant initialized for server: ${serverName} (${actualBots.length} bots)`);
  }

  // Server Configuration for standalone HTML interface (reads from Replit secrets)
  app.get("/api/server-config", async (req, res) => {
    try {
      // Read server configuration from Replit secrets (environment variables)
      const serverConfig = process.env.SERVER_CONFIG;

      if (serverConfig) {
        // Return the configuration string directly
        res.set('Content-Type', 'text/plain');
        res.send(serverConfig);
      } else {
        // No configuration found
        res.status(404).send('');
      }
    } catch (error) {
      console.error('Server config error:', error);
      res.status(500).send('');
    }
  });

  // ======= ADMIN ENDPOINTS =======

  // Admin Bot Instances - Get all bot instances (Admin only)
  app.get("/api/admin/bot-instances", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const bots = await storage.getAllBotInstances();
      res.json(bots);
    } catch (error) {
      console.error("Admin bot instances error:", error);
      res.status(500).json({ message: "Failed to fetch bot instances" });
    }
  });

  // Admin Activities - Get all activities across all bots (Admin only)
  app.get("/api/admin/activities", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const activities = await storage.getRecentActivities(limit);
      res.json(activities);
    } catch (error) {
      console.error("Admin activities error:", error);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Admin Stats - Get comprehensive admin statistics (Admin only)
  app.get("/api/admin/stats", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getDashboardStats();

      // Add additional admin-specific stats
      const allBots = await storage.getAllBotInstances();
      const approvedBots = allBots.filter(bot => bot.approvalStatus === 'approved');
      const pendingBots = allBots.filter(bot => bot.approvalStatus === 'pending');
      const onlineBots = allBots.filter(bot => bot.status === 'online');

      const adminStats = {
        ...stats,
        totalBots: allBots.length,
        approvedBots: approvedBots.length,
        pendingBots: pendingBots.length,
        onlineBots: onlineBots.length,
        offlineBots: allBots.length - onlineBots.length,
        guestBots: allBots.filter(bot => bot.isGuest).length,
        regularBots: allBots.filter(bot => !bot.isGuest).length
      };

      res.json(adminStats);
    } catch (error) {
      console.error("Admin stats error:", error);
      res.status(500).json({ message: "Failed to fetch admin statistics" });
    }
  });

  // ======= PROMOTIONAL OFFER ENDPOINTS =======

  // Get offer configuration and status
  app.get("/api/offer/status", async (req, res) => {
    try {
      const config = await storage.getOfferConfig();
      const isActive = await storage.isOfferActive();
      const timeRemaining = await storage.getOfferTimeRemaining();

      res.json({
        isActive,
        config,
        timeRemaining
      });
    } catch (error) {
      console.error("Get offer status error:", error);
      res.status(500).json({ message: "Failed to fetch offer status" });
    }
  });

  // Update offer configuration (Admin only)
  app.post("/api/offer/configure", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { durationType, durationValue, isActive } = req.body;

      const updates: Partial<any> = {};
      if (durationType !== undefined) updates.durationType = durationType;
      if (durationValue !== undefined) updates.durationValue = durationValue;
      if (isActive !== undefined) {
        updates.isActive = isActive;
        if (isActive) {
          updates.startDate = new Date();
        }
      }

      const config = await storage.updateOfferConfig(updates);

      await storage.createActivity({
        type: 'system',
        description: `Promotional offer ${isActive ? 'activated' : 'updated'}: ${durationValue} ${durationType}`,
        metadata: { config },
        serverName: getServerName()
      });

      res.json(config);
    } catch (error) {
      console.error("Update offer config error:", error);
      res.status(500).json({ message: "Failed to update offer configuration" });
    }
  });

  // ======= MASTER CONTROL ENDPOINTS =======

  // Get all servers (tenancies) for master control
  app.get("/api/master/tenancies", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const servers = await storage.getAllServers();
      const tenancies = servers.map(server => ({
        name: server.serverName,
        url: server.serverUrl,
        status: server.serverStatus,
        botCount: server.currentBotCount,
        lastSync: server.updatedAt,
        registrations: []
      }));
      res.json(tenancies);
    } catch (error) {
      console.error("Get tenancies error:", error);
      res.status(500).json({ message: "Failed to fetch tenancies" });
    }
  });

  // Get all bots across all servers
  app.get("/api/master/cross-tenancy-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const allBots = await storage.getAllBotsAcrossServers();
      const crossTenancyBots = allBots.map(bot => ({
        id: bot.id,
        name: bot.name,
        phoneNumber: bot.phoneNumber,
        status: bot.status,
        approvalStatus: bot.approvalStatus,
        tenancy: bot.serverName,
        serverName: bot.serverName,
        lastActivity: bot.lastActivity,
        isLocal: bot.serverName === getServerName(),
        settings: bot.settings,
        autoLike: bot.autoLike,
        autoReact: bot.autoReact,
        autoViewStatus: bot.autoViewStatus,
        chatgptEnabled: bot.chatgptEnabled,
        credentials: bot.credentials,
        messagesCount: bot.messagesCount,
        commandsCount: bot.commandsCount,
        approvalDate: bot.approvalDate,
        expirationMonths: bot.expirationMonths,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt
      }));
      res.json(crossTenancyBots);
    } catch (error) {
      console.error("Get cross-tenancy bots error:", error);
      res.status(500).json({ message: "Failed to fetch cross-tenancy bots" });
    }
  });

  // Get all approved bots across all servers
  app.get("/api/master/approved-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const approvedBots = await storage.getAllApprovedBots();
      res.json(approvedBots);
    } catch (error) {
      console.error("Get approved bots error:", error);
      res.status(500).json({ message: "Failed to fetch approved bots" });
    }
  });

  // Perform bot action cross-server (approve, revoke, start, stop, delete)
  app.post("/api/master/bot-action", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { action, botId, tenancy, data } = req.body;

      if (!action || !botId || !tenancy) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      switch (action) {
        case 'approve':
          const duration = data?.duration;
          const approvedBot = await storage.approveBotCrossServer(botId, tenancy, duration);
          res.json({ success: true, bot: approvedBot });
          break;

        case 'revoke':
          const revokedBot = await storage.revokeBotApproval(botId, tenancy);
          res.json({ success: true, bot: revokedBot });
          break;

        case 'delete':
          await storage.deleteBotCrossServer(botId, tenancy);
          res.json({ success: true, message: 'Bot deleted successfully' });
          break;

        case 'start':
        case 'stop':
        case 'restart':
          if (tenancy === getServerName()) {
            if (action === 'start') {
              await botManager.startBot(botId);
            } else if (action === 'stop') {
              await botManager.stopBot(botId);
            } else if (action === 'restart') {
              await botManager.restartBot(botId);
            }
            res.json({ success: true, message: `Bot ${action}ed successfully` });
          } else {
            res.status(400).json({ message: `Cannot ${action} bot on remote server ${tenancy}` });
          }
          break;

        default:
          res.status(400).json({ message: `Unknown action: ${action}` });
      }
    } catch (error) {
      console.error("Bot action error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to perform bot action" });
    }
  });

  // Master feature management for cross-tenancy bot feature toggles
  app.post("/api/master/feature-management", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { action, botId, tenancy, feature, enabled } = req.body;

      if (action !== 'toggle_feature') {
        return res.status(400).json({ message: "Invalid action. Only 'toggle_feature' is supported" });
      }

      if (!botId || !tenancy || !feature || enabled === undefined) {
        return res.status(400).json({ message: "Missing required fields: botId, tenancy, feature, enabled" });
      }

      // Get bot instance
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (bot.serverName !== tenancy) {
        return res.status(400).json({ message: "Bot does not belong to specified tenancy" });
      }

      // Only allow approved bots to have features toggled
      if (bot.approvalStatus !== 'approved') {
        return res.status(400).json({ message: "Only approved bots can have features toggled" });
      }

      // Map feature names to database columns
      const featureMap: Record<string, string> = {
        'autoLike': 'autoLike',
        'autoReact': 'autoReact',
        'autoView': 'autoViewStatus',
        'autoViewStatus': 'autoViewStatus',
        'chatGPT': 'chatgptEnabled',
        'chatgptEnabled': 'chatgptEnabled',
        'alwaysOnline': 'alwaysOnline',
        'typingIndicator': 'typingMode',
        'autoRecording': 'presenceMode',
        'presenceAutoSwitch': 'presenceAutoSwitch'
      };

      const dbColumn = featureMap[feature];
      if (!dbColumn) {
        return res.status(400).json({ message: `Unknown feature: ${feature}` });
      }

      // Build update object
      const updateData: any = {};

      if (dbColumn === 'typingMode') {
        updateData[dbColumn] = enabled ? 'composing' : 'none';
      } else if (dbColumn === 'presenceMode') {
        updateData[dbColumn] = enabled ? 'recording' : 'none';
      } else {
        updateData[dbColumn] = enabled;
      }

      // Update bot instance
      await storage.updateBotInstance(bot.id, updateData);

      // Log activity
      await storage.createActivity({
        botInstanceId: bot.id,
        type: 'feature_toggle',
        description: `Master control toggled ${feature} to ${enabled} for bot ${bot.name}`,
        metadata: { feature, enabled, tenancy },
        serverName: getServerName()
      });

      res.json({
        success: true,
        message: `Feature ${feature} ${enabled ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      console.error("Feature management error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to toggle feature"
      });
    }
  });

  // Command sync across tenancies
  app.post("/api/master/sync-commands", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { sourceServer, targetServers, commandIds } = req.body;

      if (!sourceServer || !targetServers || !commandIds) {
        return res.status(400).json({ message: "Missing required fields: sourceServer, targetServers, commandIds" });
      }

      if (!Array.isArray(targetServers) || !Array.isArray(commandIds)) {
        return res.status(400).json({ message: "targetServers and commandIds must be arrays" });
      }

      // Get commands from source server
      const commands = [];
      for (const commandId of commandIds) {
        const command = await storage.getCommand(commandId);
        if (command) {
          commands.push(command);
        }
      }

      if (commands.length === 0) {
        return res.status(404).json({ message: "No commands found with provided IDs" });
      }

      let syncedCount = 0;
      const errors: string[] = [];

      // Sync to each target server
      for (const targetServer of targetServers) {
        try {
          for (const command of commands) {
            // Create command in target server (with new ID)
            await storage.createCommand({
              name: command.name,
              response: command.response,
              description: command.description,
              isActive: command.isActive,
              useChatGPT: command.useChatGPT,
              serverName: targetServer
            });
            syncedCount++;
          }
        } catch (error) {
          errors.push(`Failed to sync to ${targetServer}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      res.json({
        success: true,
        syncedCount,
        totalAttempts: targetServers.length * commandIds.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Command sync error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to sync commands"
      });
    }
  });

  // Bot migration between servers
  app.post("/api/master/migrate-bot", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { botId, sourceServer, targetServer } = req.body;

      if (!botId || !sourceServer || !targetServer) {
        return res.status(400).json({ message: "Missing required fields: botId, sourceServer, targetServer" });
      }

      if (sourceServer === targetServer) {
        return res.status(400).json({ message: "Source and target servers must be different" });
      }

      // Get bot from source server
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (bot.serverName !== sourceServer) {
        return res.status(400).json({ message: "Bot does not belong to source server" });
      }

      // Check target server capacity
      const targetServerInfo = await storage.getServerByName(targetServer);
      const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);

      if (targetServerInfo && (targetServerInfo.currentBotCount || 0) >= targetServerInfo.maxBotCount) {
        return res.status(400).json({ message: "Target server is at full capacity" });
      }

      // Update bot's server assignment
      await storage.updateBotInstance(botId, {
        serverName: targetServer
      });

      // Update server bot counts
      await storage.updateServerBotCount(sourceServer, -1);
      await storage.updateServerBotCount(targetServer, 1);

      // Update God Registry
      if (bot.phoneNumber) {
        const cleanedPhone = bot.phoneNumber.replace(/[\s\-\(\)\+]/g, '');
        await storage.updateGlobalRegistration(cleanedPhone, targetServer);
      }

      // Log activity
      await storage.createActivity({
        botInstanceId: botId,
        type: 'migration',
        description: `Bot migrated from ${sourceServer} to ${targetServer}`,
        metadata: { sourceServer, targetServer },
        serverName: getServerName()
      });

      res.json({
        success: true,
        message: `Bot successfully migrated from ${sourceServer} to ${targetServer}`
      });
    } catch (error) {
      console.error("Bot migration error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to migrate bot"
      });
    }
  });

  // Batch operations on multiple bots
  app.post("/api/master/batch-operation", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { operation, botIds, targetServer } = req.body;

      if (!operation || !botIds || !Array.isArray(botIds)) {
        return res.status(400).json({ message: "Missing required fields: operation, botIds (array)" });
      }

      let completedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const botId of botIds) {
        try {
          const bot = await storage.getBotInstance(botId);
          if (!bot) {
            errors.push(`Bot ${botId} not found`);
            failedCount++;
            continue;
          }

          switch (operation) {
            case 'approve':
              await storage.updateBotInstance(botId, {
                approvalStatus: 'approved',
                approvalDate: new Date().toISOString(),
                expirationMonths: 3
              });
              completedCount++;
              break;

            case 'revoke':
              await storage.updateBotInstance(botId, {
                approvalStatus: 'dormant'
              });
              completedCount++;
              break;

            case 'delete':
              await storage.deleteBotInstance(botId);
              completedCount++;
              break;

            case 'migrate':
              if (!targetServer) {
                errors.push(`Bot ${botId}: targetServer required for migration`);
                failedCount++;
                continue;
              }
              await storage.updateBotInstance(botId, {
                serverName: targetServer
              });
              completedCount++;
              break;

            case 'start':
              if (bot.serverName === getServerName()) {
                await botManager.startBot(botId);
                completedCount++;
              } else {
                errors.push(`Bot ${botId}: Cannot start bot on remote server ${bot.serverName}`);
                failedCount++;
              }
              break;

            case 'stop':
              if (bot.serverName === getServerName()) {
                await botManager.stopBot(botId);
                completedCount++;
              } else {
                errors.push(`Bot ${botId}: Cannot stop bot on remote server ${bot.serverName}`);
                failedCount++;
              }
              break;

            default:
              errors.push(`Bot ${botId}: Unknown operation ${operation}`);
              failedCount++;
          }
        } catch (error) {
          errors.push(`Bot ${botId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          failedCount++;
        }
      }

      res.json({
        success: true,
        completedCount,
        failedCount,
        totalCount: botIds.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Batch operation error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to perform batch operation"
      });
    }
  });

  // Delete server from registry
  app.delete("/api/master/server/:serverName", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { serverName } = req.params;

      if (!serverName) {
        return res.status(400).json({ message: "Server name is required" });
      }

      await storage.deleteServer(serverName);
      res.json({ success: true, message: `Server ${serverName} deleted successfully` });
    } catch (error) {
      console.error("Delete server error:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to delete server" });
    }
  });

  // Bot Instances
  app.get("/api/bot-instances", async (req, res) => {
    try {
      const showPendingOnly = req.query.pending === 'true';

      if (showPendingOnly) {
        // Show only pending bots for approval workflow
        const bots = await storage.getBotInstancesByApprovalStatus('pending');
        res.json(bots);
      } else {
        // Show all bots (default behavior)
        const bots = await storage.getAllBotInstances();
        res.json(bots);
      }
    } catch (error) {
      console.error("Bot instances error:", error);
      res.status(500).json({ message: "Failed to fetch bot instances" });
    }
  });

  // Pending Bots (Admin only)
  app.get("/api/bots/pending", async (req, res) => {
    try {
      const pendingBots = await storage.getPendingBots();
      res.json(pendingBots);
    } catch (error) {
      console.error("Get pending bots error:", error);
      res.status(500).json({ message: "Failed to fetch pending bots" });
    }
  });

  // Approved Bots (Admin only)
  app.get("/api/bots/approved", async (req, res) => {
    try {
      const approvedBots = await storage.getApprovedBots();
      res.json(approvedBots);
    } catch (error) {
      console.error("Get approved bots error:", error);
      res.status(500).json({ message: "Failed to fetch approved bots" });
    }
  });

  // Approve Bot (Admin only)
  app.post("/api/bot-instances/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const { expirationMonths = 3, targetServer } = req.body; // targetServer for cross-registration

      // Get bot details first
      const bot = await storage.getBotInstance(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      const currentServer = getServerName();

      // If targetServer is specified and different from current, do cross-server approval
      if (targetServer && targetServer !== currentServer) {
        // Verify target server has capacity
        const targetCapacityCheck = await storage.strictCheckBotCountLimit(targetServer);
        if (!targetCapacityCheck.canAdd) {
          return res.status(400).json({
            message: `Selected server "${targetServer}" is at capacity (${targetCapacityCheck.currentCount}/${targetCapacityCheck.maxCount}).`,
            serverFull: true,
            currentCount: targetCapacityCheck.currentCount,
            maxCount: targetCapacityCheck.maxCount
          });
        }

        // Move bot to target server using cross-server registration
        const result = await storage.approveBotCrossServer(id, targetServer, expirationMonths);

        broadcast({ type: 'BOT_APPROVED', data: result });
        return res.json({
          message: `Bot approved and registered on ${targetServer} successfully`,
          crossServer: true,
          targetServer,
          bot: result
        });
      }

      // Check current server capacity before approving on current server
      const capacityCheck = await storage.strictCheckBotCountLimit();
      if (!capacityCheck.canAdd) {
        // Get available servers for suggestion
        const availableServers = await storage.getServersWithAvailableSlots();

        if (availableServers.length === 0) {
          return res.status(400).json({
            message: "Current server is at capacity and no other servers available. Please increase server capacity or wait for slots.",
            serverFull: true,
            allServersFull: true,
            currentCount: capacityCheck.currentCount,
            maxCount: capacityCheck.maxCount
          });
        }

        // Suggest available servers
        return res.status(400).json({
          message: `Current server ${currentServer} is at capacity (${capacityCheck.currentCount}/${capacityCheck.maxCount}). Please select a different server for this bot.`,
          serverFull: true,
          currentServer,
          currentCount: capacityCheck.currentCount,
          maxCount: capacityCheck.maxCount,
          availableServers: availableServers.map(s => ({
            serverName: s.serverName,
            currentCount: s.currentBotCount || 0,
            maxCount: s.maxBotCount,
            availableSlots: s.maxBotCount - (s.currentBotCount || 0)
          })),
          suggestedAction: "Re-submit approval request with 'targetServer' parameter"
        });
      }

      // Update bot to approved status on current server
      const updatedBot = await storage.updateBotInstance(id, {
        approvalStatus: 'approved',
        approvalDate: new Date().toISOString(),
        expirationMonths,
        status: 'loading' // Set to loading as we're about to start it
      });

      // Log activity
      await storage.createActivity({
        botInstanceId: id,
        type: 'approval',
        description: `Bot approved for ${expirationMonths} months by admin`,
        metadata: { expirationMonths },
        serverName: getServerName()
      });

      // Automatically start the bot after approval (ALL approved bots will be automatically started and monitored)
      try {
        console.log(`🚀 AUTO-START POLICY: Starting newly approved bot ${bot.name} (${bot.id})...`);
        console.log(`   📋 ALL approved bots will be automatically started and monitored`);
        await botManager.startBot(id);

        // Wait a moment for the bot to initialize before sending notification
        setTimeout(async () => {
          try {
            if (bot.phoneNumber) {
              const approvalMessage = `╔══════════════════════════════════════════╗
║ 🎉        TREKKER-MD APPROVAL        🎉   ║
╠══════════════════════════════════════════╣
║ ✅ Bot "${bot.name}" is now ACTIVE!           ║
║ 📱 Phone: ${bot.phoneNumber}                    ║
║ 📅 Approved: ${new Date().toLocaleDateString()}                    ║
║ ⏳ Valid: ${expirationMonths} Months                       ║
╠══════════════════════════════════════════╣
║ 🚀 Features Enabled:                      ║
║ • Automation & ChatGPT                    ║
║ • Auto-like / Auto-react                  ║
║ • Status Viewing                          ║
╠══════════════════════════════════════════╣
║ 🔥 Thank you for choosing TREKKER-MD!     ║
╚══════════════════════════════════════════╝`;

              // Send notification using the bot's own credentials
              const messageSent = await botManager.sendMessageThroughBot(id, bot.phoneNumber, approvalMessage);

              if (messageSent) {
                console.log(`✅ Approval notification sent to ${bot.phoneNumber} via bot ${bot.name}`);
              } else {
                console.log(`⚠️ Failed to send approval notification to ${bot.phoneNumber} - bot might not be online yet`);
              }
            }
          } catch (notificationError) {
            console.error('Failed to send approval notification:', notificationError);
          }
        }, 5000); // Wait 5 seconds for bot to fully initialize

      } catch (startError) {
        console.error(`Failed to auto-start bot ${id}:`, startError);
        // Update status to error if start failed
        await storage.updateBotInstance(id, { status: 'error' });
      }

      broadcast({ type: 'BOT_APPROVED', data: updatedBot });
      res.json({ message: "Bot approved successfully and starting automatically" });
    } catch (error) {
      console.error('Bot approval error:', error);
      res.status(500).json({ message: "Failed to approve bot" });
    }
  });

  // Reject Bot (Admin only)
  app.post("/api/bots/:id/reject", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const success = await storage.rejectBotInstance(id);
      if (success) {
        res.json({ message: "Bot rejected successfully" });
      } else {
        res.status(404).json({ message: "Bot not found" });
      }
    } catch (error) {
      console.error("Reject bot error:", error);
      res.status(500).json({ message: "Failed to reject bot" });
    }
  });

  // Toggle Bot Features (Admin only)
  app.post("/api/bots/:id/toggle-feature", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { feature, enabled } = req.body;

      const bot = await storage.getBotInstance(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Update bot settings
      const currentSettings = (bot.settings as any) || {};
      const features = (currentSettings.features as any) || {};
      features[feature] = enabled;

      const success = await storage.updateBotInstance(id, {
        settings: { ...currentSettings, features }
      });

      if (success) {
        await storage.createActivity({
          botInstanceId: id,
          type: 'settings_change',
          description: `Admin ${enabled ? 'enabled' : 'disabled'} ${feature} feature`,
          metadata: { feature, enabled, admin: true },
          serverName: getServerName()
        });
        res.json({ message: "Feature updated successfully" });
      } else {
        res.status(404).json({ message: "Failed to update feature" });
      }
    } catch (error) {
      console.error("Toggle feature error:", error);
      res.status(500).json({ message: "Failed to toggle feature" });
    }
  });

  app.get("/api/bot-instances/:id", async (req, res) => {
    try {
      const bot = await storage.getBotInstance(req.params.id);
      if (!bot) {
        return res.status(404).json({ message: "Bot instance not found" });
      }
      res.json(bot);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bot instance" });
    }
  });

  app.post("/api/bot-instances", upload.single('credentials') as any, async (req, res) => {
    try {
      let credentials = null;

      // Handle base64 credentials
      if (req.body.credentialsBase64) {
        try {
          const base64Data = req.body.credentialsBase64.trim();
          if (!base64Data) {
            return res.status(400).json({
              message: "Base64 credentials string is empty. Please provide valid base64-encoded credentials."
            });
          }

          // Decode credentials using utility (handles TREKKER~ prefix removal)
          credentials = decodeCredentials(base64Data);

          // Validate that it's a proper WhatsApp credentials file
          if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
            return res.status(400).json({
              message: "Invalid credentials format. Please ensure your base64 string contains valid WhatsApp session data."
            });
          }

          // Check for empty object
          if (Object.keys(credentials).length === 0) {
            return res.status(400).json({
              message: "Credentials are empty. Please provide valid base64-encoded credentials with session data."
            });
          }

          // Validate Baileys v7 credentials
          const validation = validateBaileysCredentials(credentials);
          if (!validation.valid) {
            return res.status(400).json({
              message: `Invalid Baileys credentials: ${validation.error}`
            });
          }
        } catch (error) {
          return res.status(400).json({
            message: `Invalid credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      } else if (req.file) {
        // Check file size (minimum 10 bytes, maximum 5MB)
        if (req.file.size < 10) {
          return res.status(400).json({
            message: "Credentials file is too small or empty. Please upload a valid credentials file."
          });
        }

        if (req.file.size > 5 * 1024 * 1024) {
          return res.status(400).json({
            message: "Credentials file is too large. Maximum size is 5MB."
          });
        }

        try {
          const fileContent = req.file.buffer.toString();
          if (!fileContent.trim()) {
            return res.status(400).json({
              message: "Credentials file is empty. Please upload a valid credentials file."
            });
          }

          credentials = JSON.parse(fileContent);

          // Validate that it's a proper WhatsApp credentials file
          if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
            return res.status(400).json({
              message: "Invalid credentials file format. Please upload a valid WhatsApp session file."
            });
          }

          // Check for empty object
          if (Object.keys(credentials).length === 0) {
            return res.status(400).json({
              message: "Credentials file is empty. Please upload a valid credentials file with session data."
            });
          }
        } catch (error) {
          return res.status(400).json({
            message: "Invalid JSON file. Please ensure you're uploading a valid credentials.json file from WhatsApp Web."
          });
        }
      }

      if (!req.body.name || req.body.name.trim() === '') {
        return res.status(400).json({
          message: "Bot name is required. Please provide a name for your bot instance."
        });
      }

      // Check for duplicate bot name and bot count limit
      const existingBots = await storage.getAllBotInstances();

      // Check bot count limit using strict validation (no auto-removal)
      const botCountCheck = await storage.strictCheckBotCountLimit();
      if (!botCountCheck.canAdd) {
        console.log(`🚫 Current server ${getServerName()} is at capacity`);

        // Server is full - attempt auto-assignment to available server
        const availableServers = await storage.getAvailableServers();
        if (availableServers.length === 0) {
          return res.status(400).json({
            message: `All servers are at capacity. Please try again later or contact support.`,
            serverFull: true,
            allServersFull: true
          });
        }

        // Select the server with the most available slots
        const targetServer = availableServers.reduce((prev, current) => {
          const prevAvailable = prev.maxBotCount - (prev.currentBotCount || 0);
          const currentAvailable = current.maxBotCount - (current.currentBotCount || 0);
          return currentAvailable > prevAvailable ? current : prev;
        });

        console.log(`🌍 Auto-selecting target server: ${targetServer.serverName}`);

        // Perform cross-server registration
        const crossServerResult = await storage.createCrossServerRegistration(
          cleanedPhone,
          targetServer.serverName,
          botData
        );

        if (!crossServerResult.success) {
          return res.status(500).json({
            success: false,
            message: crossServerResult.error || "Cross-server registration failed"
          });
        }

        console.log(`✅ Bot successfully auto-assigned to ${targetServer.serverName}`);

        // Send success message to the user via WhatsApp
        try {
          if (credentials) {
            const validationMessage = offerActive
              ? `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}
🏢 Server: ${targetServer.serverName} (Auto-assigned)

🎁 PROMOTIONAL OFFER ACTIVE!
✨ Your bot has been AUTO-APPROVED!
🚀 Your bot is now LIVE and ready to use!

Enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`
              : `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}

⏳ Status: Awaiting admin approval
📞 Contact: +254704897825 for activation

🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;

            await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), validationMessage, true);
            console.log(`✅ Registration success message sent to ${cleanedPhone} on ${targetServer.serverName}`);
          }
        } catch (messageError) {
          console.error('Failed to send registration success message:', messageError);
        }

        return res.json({
          success: true,
          type: 'cross_tenancy_registered',
          message: `Registration successful! Your bot has been automatically assigned to ${targetServer.serverName} for optimal performance.`,
          botDetails: maskBotDataForGuest(crossServerResult.botInstance!, true),
          originalServer: currentServer,
          assignedServer: targetServer.serverName,
          availableSlots: targetServer.maxBotCount - (targetServer.currentBotCount || 0) - 1,
          serverUrl: targetServer.serverUrl,
          nextSteps: [
            `Your bot "${botName}" is now registered on ${targetServer.serverName}`,
            `Contact +254704897825 to activate your bot`,
            `Once approved, you can manage your bot from any server`,
            `Cross-server management ensures the best performance`
          ]
        });
      }

      const duplicateName = existingBots.find(bot =>
        bot.name.toLowerCase().trim() === req.body.name.toLowerCase().trim()
      );

      if (duplicateName) {
        return res.status(400).json({
          message: `Bot name "${req.body.name.trim()}" is already in use. Please choose a different name.`
        });
      }

      // Check for duplicate credentials if provided
      if (credentials) {
        const duplicateCredentials = existingBots.find(bot => {
          if (!bot.credentials) return false;
          // Compare essential credential fields to detect duplicates
          return JSON.stringify(bot.credentials) === JSON.stringify(credentials);
        });

        if (duplicateCredentials) {
          return res.status(400).json({
            message: `These credentials are already in use by bot "${duplicateCredentials.name}". Each bot must have unique credentials.`
          });
        }
      }

      const botData = {
        ...req.body,
        credentials,
        name: req.body.name.trim(),
        autoLike: req.body.autoLike === 'true',
        autoViewStatus: req.body.autoViewStatus === 'true',
        autoReact: req.body.autoReact === 'true',
        chatgptEnabled: req.body.chatgptEnabled === 'true',
      };

      const validatedData = insertBotInstanceSchema.parse(botData);
      const bot = await storage.createBotInstance(validatedData);

      // Initialize bot instance
      try {
        await botManager.createBot(bot.id, bot);

        // Set a timeout to delete the bot if it doesn't connect within 5 minutes
        setTimeout(async () => {
          try {
            const currentBot = await storage.getBotInstance(bot.id);
            if (currentBot && (currentBot.status === 'loading' || currentBot.status === 'error')) {
              console.log(`Auto-deleting bot ${bot.id} due to connection timeout`);
              await botManager.destroyBot(bot.id);
              await storage.deleteBotInstance(bot.id);
              await storage.createActivity({
                botInstanceId: bot.id,
                type: 'auto_cleanup',
                description: `Bot "${bot.name}" was automatically deleted due to connection failure`,
                serverName: getServerName()
              });
              broadcast({ type: 'BOT_DELETED', data: { botId: bot.id } });
            }
          } catch (cleanupError) {
            console.error(`Failed to auto-cleanup bot ${bot.id}:`, cleanupError);
          }
        }, 5 * 60 * 1000); // 5 minutes
      } catch (botError) {
        // If bot creation fails, clean up the database entry
        await storage.deleteBotInstance(bot.id);
        throw new Error(`Failed to initialize bot: ${botError instanceof Error ? botError.message : 'Unknown error'}`);
      }

      // Create welcome activity
      await storage.createActivity({
        botInstanceId: bot.id,
        type: 'bot_created',
        description: `🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot "${bot.name}" created successfully!`,
        serverName: getServerName()
      });

      broadcast({ type: 'BOT_CREATED', data: bot });
      res.json(bot);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create bot instance";
      console.error('Bot creation error:', error);

      // Provide more specific error messages
      let userMessage = errorMessage;
      if (errorMessage.includes('name')) {
        userMessage = "Bot name is invalid or already exists. Please choose a different name.";
      } else if (errorMessage.includes('credentials')) {
        userMessage = "Invalid credentials file. Please upload a valid WhatsApp session file.";
      } else if (errorMessage.includes('Expected object')) {
        userMessage = "Missing required bot configuration. Please fill in all required fields.";
      }

      res.status(400).json({ message: userMessage });
    }
  });



  // Enhanced session validation endpoint - validates by sending WhatsApp message
  app.post('/api/whatsapp/validate-session', async (req, res) => {
    try {
      const { sessionId, phoneNumber } = req.body;

      if (!sessionId || !phoneNumber) {
        return res.status(400).json({ valid: false, message: 'Session ID and phone number are required.' });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Use the centralized credential decoder (same as quick register)
      let credentials = null;
      try {
        credentials = decodeCredentials(sessionId.trim());
        console.log('✅ Session ID decoded successfully');
      } catch (error) {
        console.error('❌ Session ID decode error:', error);
        return res.status(400).json({
          valid: false,
          message: `Invalid session ID: ${error instanceof Error ? error.message : 'Unable to decode'}`
        });
      }

      // Validate using Baileys v7 credentials validator (same as quick register)
      const validation = validateBaileysCredentials(credentials);
      if (!validation.valid) {
        console.error('❌ Baileys validation failed:', validation.error);
        return res.status(400).json({
          valid: false,
          message: `Invalid Baileys credentials: ${validation.error}`
        });
      }

      // Use the normalized credentials (v7 format)
      credentials = validation.normalized || credentials;

      // Extract phone number using centralized utility (supports both LID and JID)
      const extractedPhoneNumber = extractPhoneNumber(credentials);

      if (!extractedPhoneNumber) {
        console.error('❌ Cannot extract phone number from credentials');
        return res.status(400).json({
          valid: false,
          message: 'Unable to extract phone number from credentials. Please ensure you have valid WhatsApp session data.'
        });
      }

      if (extractedPhoneNumber !== cleanedPhone) {
        return res.status(400).json({
          valid: false,
          message: `Phone number mismatch: credentials are for ${extractedPhoneNumber}, but you provided ${cleanedPhone}.`
        });
      }

      console.log(`✅ Session validation successful for ${cleanedPhone}, now testing WhatsApp connection...`);

      // Test the session by sending a validation message to WhatsApp
      try {
        const validationMessage = `╔══════════════════════════════════════════╗
║ 🎉    TREKKER-MD SESSION VALIDATION  🎉   ║
╠══════════════════════════════════════════╣
║ ✅ Your Session ID is VALID!              ║
║ 📱 Phone: ${cleanedPhone}                    ║
║ 📅 Validated: ${new Date().toLocaleDateString()}                  ║
║ ⏰ Time: ${new Date().toLocaleTimeString()}                      ║
╠══════════════════════════════════════════╣
║ 🚀 What's Next:                           ║
║ • Your credentials are verified           ║
║ • Ready to register your bot              ║
║ • Click "Register Bot" to continue        ║
╠══════════════════════════════════════════╣
║ 🔥 Thank you for choosing TREKKER-MD!     ║
╚══════════════════════════════════════════╝`;

        console.log(`📤 Attempting to send validation message to ${cleanedPhone}...`);
        const messageSent = await sendGuestValidationMessage(
          cleanedPhone,
          JSON.stringify(credentials),
          validationMessage,
          true // Preserve credentials
        );

        if (messageSent) {
          console.log(`✅ Validation message sent successfully to ${cleanedPhone}`);
          res.json({
            valid: true,
            message: '✅ Session validated successfully! Check your WhatsApp for confirmation message.',
            phoneNumber: cleanedPhone,
            messageSent: true
          });
        } else {
          console.log(`⚠️ Session structure is valid but WhatsApp connection failed for ${cleanedPhone}`);
          res.json({
            valid: true,
            message: '✅ Session structure is valid. Note: WhatsApp confirmation message could not be sent (session may need refresh). You can still proceed with registration.',
            phoneNumber: cleanedPhone,
            messageSent: false,
            warning: 'WhatsApp connection test failed - credentials may be expired'
          });
        }
      } catch (messageError: any) {
        console.error('Error sending validation message:', messageError);
        const errorMsg = messageError.message || 'Unknown error';

        // Check if it's a connection failure (405 error)
        if (errorMsg.includes('Connection') || errorMsg.includes('405')) {
          console.log(`⚠️ WhatsApp connection failed - credentials may be expired or session needs refresh`);
          res.json({
            valid: true,
            message: '⚠️ Session structure is valid but WhatsApp connection failed. Your session may be expired. Try getting a fresh session ID or proceed with registration and update credentials later.',
            phoneNumber: cleanedPhone,
            messageSent: false,
            warning: 'WhatsApp connection failed - session may be expired'
          });
        } else {
          // Session structure is still valid even if message fails
          res.json({
            valid: true,
            message: '✅ Session structure is valid. Confirmation message could not be sent. You can proceed with registration.',
            phoneNumber: cleanedPhone,
            messageSent: false,
            warning: errorMsg
          });
        }
      }

    } catch (error) {
      console.error('Session validation error:', error);
      res.status(500).json({
        valid: false,
        message: 'Failed to validate session: ' + (error instanceof Error ? error.message : 'Unknown error')
      });
    }
  });

  app.patch("/api/bot-instances/:id", async (req, res) => {
    try {
      const bot = await storage.updateBotInstance(req.params.id, req.body);
      broadcast({ type: 'BOT_UPDATED', data: bot });
      res.json(bot);
    } catch (error) {
      res.status(500).json({ message: "Failed to update bot instance" });
    }
  });

  app.delete("/api/bot-instances/:id", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      // Get bot instance to retrieve phone number before deletion
      const botInstance = await storage.getBotInstance(req.params.id);

      await botManager.destroyBot(req.params.id);

      // Delete all related data (commands, activities, groups)
      await storage.deleteBotRelatedData(req.params.id);

      // Delete the bot instance itself
      await storage.deleteBotInstance(req.params.id);

      // Remove from god register table if bot instance was found
      if (botInstance && botInstance.phoneNumber) {
        await storage.deleteGlobalRegistration(botInstance.phoneNumber);
        console.log(`🗑️ Removed ${botInstance.phoneNumber} from god register table`);
      }

      broadcast({ type: 'BOT_DELETED', data: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      console.error('Delete bot error:', error);
      res.status(500).json({ message: "Failed to delete bot instance" });
    }
  });

  // Toggle Bot Feature
  app.post("/api/bot-instances/:id/toggle-feature", async (req, res) => {
    try {
      const { id } = req.params;
      const { feature, enabled } = req.body;

      if (!feature || enabled === undefined) {
        return res.status(400).json({ message: "Feature and enabled status are required" });
      }

      // Get bot instance
      const bot = await storage.getBotInstance(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Only allow approved bots to have features toggled
      if (bot.approvalStatus !== 'approved') {
        return res.status(400).json({ message: "Only approved bots can have features toggled" });
      }

      // Map feature names to database columns
      const featureMap: Record<string, string> = {
        'autoLike': 'autoLike',
        'autoView': 'autoViewStatus',
        'autoReact': 'autoReact',
        'chatGPT': 'chatgptEnabled',
        'alwaysOnline': 'alwaysOnline',
        'typingIndicator': 'typingMode',
        'presenceAutoSwitch': 'presenceAutoSwitch'
      };

      const dbField = featureMap[feature];
      if (!dbField) {
        return res.status(400).json({ message: "Invalid feature name" });
      }

      // Prepare update object
      const updateData: any = {};

      // Handle special feature mappings
      if (feature === 'typingIndicator') {
        updateData.typingMode = enabled ? 'typing' : 'none';
      } else {
        updateData[dbField] = enabled;
      }

      // Also update settings.features
      const currentSettings = (bot.settings as any) || {};
      const currentFeatures = (currentSettings.features as any) || {};
      updateData.settings = {
        ...currentSettings,
        features: {
          ...currentFeatures,
          [feature]: enabled
        }
      };

      await storage.updateBotInstance(id, updateData);

      // Log activity
      await storage.createActivity({
        botInstanceId: id,
        type: 'feature_toggle',
        description: `${feature} ${enabled ? 'enabled' : 'disabled'}`,
        metadata: { feature, enabled },
        serverName: getServerName()
      });

      res.json({ message: "Feature updated successfully", feature, enabled });

    } catch (error) {
      console.error('Feature toggle error:', error);
      res.status(500).json({ message: "Failed to toggle feature" });
    }
  });

  // Commands
  app.get("/api/commands", async (req, res) => {
    try {
      const botInstanceId = req.query.botInstanceId as string;
      let commands = await storage.getCommands(botInstanceId);

      // If database is empty and no specific bot instance requested, populate with registered commands
      if (commands.length === 0 && !botInstanceId) {
        try {
          const { commandRegistry } = await import('./services/command-registry.js');
          const registeredCommands = commandRegistry.getAllCommands();

          console.log('Database empty, populating with registered commands...');

          for (const command of registeredCommands) {
            try {
              await storage.createCommand({
                name: command.name,
                description: command.description,
                response: `Executing ${command.name}...`,
                isActive: true,
                useChatGPT: false,
                serverName: getServerName()
              });
            } catch (error: any) {
              // Ignore duplicate errors
              if (!error?.message?.includes('duplicate') && !error?.message?.includes('unique')) {
                console.log(`Error saving ${command.name}:`, error?.message);
              }
            }
          }

          // Fetch commands again after populating
          commands = await storage.getCommands(botInstanceId);
          console.log(`✅ Populated database with ${commands.length} commands`);
        } catch (error) {
          console.log('Note: Could not populate database with commands:', error);
        }
      }

      res.json(commands);
    } catch (error) {
      console.error("Commands error:", error);
      res.status(500).json({ message: "Failed to fetch commands" });
    }
  });

  app.post("/api/commands", async (req, res) => {
    try {
      const validatedData = insertCommandSchema.parse(req.body);
      const command = await storage.createCommand(validatedData);
      broadcast({ type: 'COMMAND_CREATED', data: command });
      res.json(command);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create command" });
    }
  });

  app.patch("/api/commands/:id", async (req, res) => {
    try {
      const command = await storage.updateCommand(req.params.id, req.body);
      broadcast({ type: 'COMMAND_UPDATED', data: command });
      res.json(command);
    } catch (error) {
      res.status(500).json({ message: "Failed to update command" });
    }
  });

  app.delete("/api/commands/:id", async (req, res) => {
    try {
      await storage.deleteCommand(req.params.id);
      broadcast({ type: 'COMMAND_DELETED', data: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete command" });
    }
  });

  // Sync registered commands with database
  app.post("/api/commands/sync", async (req, res) => {
    try {
      const { commandRegistry } = await import('./services/command-registry.js');
      const registeredCommands = commandRegistry.getAllCommands();
      const existingCommands = await storage.getCommands();
      const existingCommandNames = new Set(existingCommands.map(cmd => cmd.name));

      let addedCount = 0;

      for (const command of registeredCommands) {
        if (!existingCommandNames.has(command.name)) {
          try {
            await storage.createCommand({
              name: command.name,
              description: command.description,
              response: `Executing ${command.name}...`,
              isActive: true,
              useChatGPT: false,
              serverName: getServerName()
            });
            addedCount++;
          } catch (error: any) {
            console.log(`Error adding ${command.name}:`, error?.message);
          }
        }
      }

      console.log(`✅ Command sync completed: ${addedCount} new commands added`);
      res.json({
        success: true,
        message: `Sync completed: ${addedCount} new commands added`,
        addedCount
      });
    } catch (error) {
      console.error("Command sync error:", error);
      res.status(500).json({ message: "Failed to sync commands" });
    }
  });

  // Custom Command Code Execution - Admin Only
  app.post("/api/commands/custom", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, code, description, category } = req.body;

      if (!name || !code || !description) {
        return res.status(400).json({ message: "Name, code, and description are required" });
      }

      // Validate the command code (basic safety check)
      if (code.includes('require(') && !code.includes('// @allow-require')) {
        return res.status(400).json({ message: "Custom require() not allowed for security reasons" });
      }

      // Create command in database
      const commandData = {
        name: name.toLowerCase(),
        description,
        response: code, // Store the custom code in response field
        isActive: true,
        useChatGPT: false,
        category: category || 'CUSTOM',
        customCode: true // Flag to identify custom code commands
      };

      const command = await storage.createCommand({
        ...commandData,
        serverName: getServerName()
      });

      // Register the command in the command registry dynamically
      const { commandRegistry } = await import('./services/command-registry.js');

      try {
        // Create a safe execution context for the custom command
        const customHandler = new Function('context', `
          const { respond, args, message, client } = context;
          return (async () => {
            ${code}
          })();
        `);

        commandRegistry.register({
          name: name.toLowerCase(),
          description,
          category: category || 'CUSTOM',
          handler: customHandler as any
        });

        console.log(`✅ Custom command '${name}' registered successfully`);
      } catch (error) {
        console.error(`❌ Failed to register custom command '${name}':`, error);
        // Remove from database if registration fails
        await storage.deleteCommand(command.id);
        return res.status(400).json({ message: "Invalid command code syntax" });
      }

      broadcast({ type: 'CUSTOM_COMMAND_CREATED', data: command });
      res.json({ success: true, command });

    } catch (error) {
      console.error('Custom command creation error:', error);
      res.status(500).json({ message: "Failed to create custom command" });
    }
  });

  // ======= ADMIN GOD REGISTRY ENDPOINTS =======

  // Get all God Registry entries (Admin only)
  app.get("/api/admin/god-registry", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const registrations = await storage.getAllGlobalRegistrations();
      res.json(registrations);
    } catch (error) {
      console.error('Get God Registry error:', error);
      res.status(500).json({ message: "Failed to fetch God Registry" });
    }
  });

  // Update God Registry entry (Admin only)
  app.put("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { phoneNumber } = req.params;
      const { tenancyName } = req.body;

      if (!tenancyName) {
        return res.status(400).json({ message: "Tenancy name is required" });
      }

      // Delete old registration
      await storage.deleteGlobalRegistration(phoneNumber);

      // Create new registration with updated tenancy
      await storage.addGlobalRegistration(phoneNumber, tenancyName);

      // Log activity
      await storage.createActivity({
        botInstanceId: 'god-registry-admin',
        type: 'god_registry_update',
        description: `God Registry updated: ${phoneNumber} moved to ${tenancyName}`,
        metadata: { phoneNumber, tenancyName, updatedBy: 'admin' },
        serverName: getServerName()
      });

      res.json({ message: "Registration updated successfully" });
    } catch (error) {
      console.error('Update God Registry error:', error);
      res.status(500).json({ message: "Failed to update registration" });
    }
  });

  // Delete God Registry entry (Admin only)
  app.delete("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { phoneNumber } = req.params;

      await storage.deleteGlobalRegistration(phoneNumber);

      // Log activity
      await storage.createActivity({
        botInstanceId: 'god-registry-admin',
        type: 'god_registry_delete',
        description: `God Registry entry deleted: ${phoneNumber}`,
        metadata: { phoneNumber, deletedBy: 'admin' },
        serverName: getServerName()
      });

      res.json({ message: "Registration deleted successfully" });
    } catch (error) {
      console.error('Delete God Registry error:', error);
      res.status(500).json({ message: "Failed to delete registration" });
    }
  });

  // ======= GUEST AUTHENTICATION ENDPOINTS =======

  // Guest Registration Check - Check if phone number is registered in God Registry
  app.post("/api/guest/check-registration", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      console.log(`🔍 Checking registration for phone ${cleanedPhone} on server ${currentServer}`);

      // Check God Registry to find if phone number is registered anywhere
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);

      if (!globalRegistration) {
        // Phone number is not registered anywhere
        return res.json({
          registered: false,
          phoneNumber: cleanedPhone,
          message: "Phone number not found in our system",
          canRegister: true
        });
      }

      const hostingServer = globalRegistration.tenancyName;
      const isCurrentServer = hostingServer === currentServer;

      if (isCurrentServer) {
        // Phone number is registered on current server - check for actual bot
        const bot = await storage.getBotByPhoneNumber(cleanedPhone);

        return res.json({
          registered: true,
          currentServer: true,
          phoneNumber: cleanedPhone,
          hasBot: !!bot,
          bot: bot ? maskBotDataForGuest(bot, true) : null,
          message: bot
            ? "Phone number found with existing bot on this server"
            : "Phone number registered to this server but no bot found"
        });
      } else {
        // Phone number is registered on different server
        return res.status(400).json({
          registered: true,
          currentServer: false,
          registeredTo: hostingServer,
          phoneNumber: cleanedPhone,
          message: `This phone number is registered to ${hostingServer}. Please use that server to manage your bot.`
        });
      }

    } catch (error) {
      console.error('Guest check registration error:', error);
      res.status(500).json({ message: "Failed to check registration" });
    }
  });

  // Admin: Send test message through bot
  app.post("/api/admin/send-message/:botId", isAdmin, async (req, res) => {
    try {
      const { botId } = req.params;
      const { recipient, message } = req.body;

      if (!recipient || !message) {
        return res.status(400).json({ message: "Recipient and message are required" });
      }

      // Get bot instance
      const bot = botManager.getBot(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found or not running" });
      }

      // Format recipient number
      const jid = recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`;

      // Send message
      await bot.sendDirectMessage(jid, message);

      res.json({
        success: true,
        message: "Message sent successfully",
        recipient: jid
      });
    } catch (error) {
      console.error("Error sending admin test message:", error);
      res.status(500).json({
        message: "Failed to send message",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Guest Bot Status Check - Check if bot exists and its status
  app.post("/api/guest/bot/status", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      console.log(`🔍 Checking bot status for phone: ${cleanedPhone}`);

      // Check if bot exists in current server
      const currentServerName = process.env.RUNTIME_SERVER_NAME || process.env.SERVER_NAME || 'Server1';
      const bot = await db.select()
        .from(botInstances)
        .where(
          and(
            eq(botInstances.phoneNumber, cleanedPhone),
            eq(botInstances.serverName, currentServerName)
          )
        )
        .limit(1);

      if (bot.length === 0) {
        console.log(`❌ No bot found for phone ${cleanedPhone} on server ${currentServerName}`);
        return res.status(404).json({
          message: "Bot not found",
          exists: false
        });
      }

      const botData = bot[0];
      const isActive = botData.status === 'online';
      const isApproved = botData.approvalStatus === 'approved';

      console.log(`✅ Bot found - Status: ${botData.status}, Approval: ${botData.approvalStatus}`);

      // Apply data masking for guest endpoint
      const maskedBotData = maskBotDataForGuest(botData, true);
      return res.json({
        exists: true,
        ...maskedBotData
      });

    } catch (error) {
      console.error("❌ Error checking bot status:", error);
      return res.status(500).json({ message: "Failed to check bot status" });
    }
  });

  // Get session ID by phone number with validation
  app.get("/api/guest/session/:phoneNumber", async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Get the most recent unused session for this phone number
      const sessions = await db.select()
        .from(guestSessions)
        .where(
          and(
            eq(guestSessions.phoneNumber, cleanedPhone),
            eq(guestSessions.isUsed, false)
          )
        )
        .orderBy(desc(guestSessions.createdAt))
        .limit(1);

      if (sessions.length === 0) {
        return res.status(404).json({
          message: "No session found for this phone number",
          found: false
        });
      }

      const session = sessions[0];
      console.log(`📊 Session found for ${cleanedPhone}:`, {
        id: session.id,
        pairingCode: session.pairingCode,
        createdAt: session.createdAt,
        sessionIdLength: session.sessionId?.length || 0
      });

      // Validate the session ID before returning it
      try {
        const decoded = Buffer.from(session.sessionId.trim(), 'base64').toString('utf-8');
        const credentials = JSON.parse(decoded);

        // Check for essential WhatsApp credentials
        const isValid = credentials?.creds?.noiseKey &&
                       credentials?.creds?.signedIdentityKey &&
                       credentials?.creds?.signedPreKey &&
                       credentials?.creds?.registrationId &&
                       credentials?.keys &&
                       Object.keys(credentials.keys).length > 0;

        if (!isValid) {
          console.error(`❌ Invalid session ID found for ${cleanedPhone} - missing essential fields`);
          // Delete the invalid session
          await db.delete(guestSessions).where(eq(guestSessions.id, session.id));
          return res.status(404).json({
            message: "Session ID is invalid - please generate a new pairing code",
            found: false
          });
        }

        console.log(`✅ Valid session retrieved for ${cleanedPhone}`);

        return res.json({
          found: true,
          sessionId: session.sessionId,
          pairingCode: session.pairingCode,
          createdAt: session.createdAt
        });

      } catch (validationError) {
        console.error(`❌ Session validation error for ${cleanedPhone}:`, validationError);
        // Delete the corrupted session
        await db.delete(guestSessions).where(eq(guestSessions.id, session.id));
        return res.status(404).json({
          message: "Session ID is corrupted - please generate a new pairing code",
          found: false
        });
      }

    } catch (error) {
      console.error("❌ Error retrieving session:", error);
      return res.status(500).json({ message: "Failed to retrieve session" });
    }
  });

  // Guest OTP Request - Send verification code via WhatsApp with credential validation
  app.post("/api/guest/auth/send-otp", async (req, res) => {
    console.log("[secure_guest_otp] Enhanced security endpoint reached - enforcing credential validation");
    try {
      const { phoneNumber, sessionData } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Validate phone number format (basic check)
      if (!/^\d{10,15}$/.test(cleanedPhone)) {
        return res.status(400).json({ message: "Invalid phone number format" });
      }

      console.log(`🔍 Enhanced Guest OTP: Checking bot status first for ${cleanedPhone}`);

      // Step 1: Check if bot exists and get its status
      const currentServerName = process.env.RUNTIME_SERVER_NAME || process.env.SERVER_NAME || 'Server1';
      const bot = await db.select()
        .from(botInstances)
        .where(
          and(
            eq(botInstances.phoneNumber, cleanedPhone),
            eq(botInstances.serverName, currentServerName)
          )
        )
        .limit(1);

      if (bot.length === 0) {
        console.log(`❌ Bot not found for phone ${cleanedPhone}`);
        return res.status(404).json({
          message: "Bot not found. Please register your bot first.",
          exists: false
        });
      }

      const botData = bot[0];
      const isActive = botData.status === 'online';
      const isApproved = botData.approvalStatus === 'approved';

      console.log(`📊 Bot Status - Active: ${isActive}, Approved: ${isApproved}`);

      // Step 2: Enhanced bot status checking with credential verification
      console.log(`📊 Enhanced Status - Active: ${isActive}, Approved: ${isApproved}, CredVerified: ${botData.credentialVerified || false}`);

      // Check if bot is not approved (priority check)
      if (!isApproved) {
        console.log(`⚠️ Bot not approved by admin`);
        return res.status(403).json({
          message: "Your bot is not approved by admin. Please wait for admin approval.",
          botStatus: "not_approved",
          nextStep: "wait_approval",
          canManage: false
        });
      }

      // Check if bot has expired (for approved bots)
      const isExpired = botData.approvalDate && botData.expirationMonths
        ? new Date() > new Date(new Date(botData.approvalDate).getTime() + (botData.expirationMonths * 30 * 24 * 60 * 60 * 1000))
        : false;

      if (isExpired) {
        console.log(`⏰ Bot has expired`);
        return res.status(403).json({
          message: "Your bot has expired. Please contact admin for renewal.",
          botStatus: "expired",
          nextStep: "wait_approval",
          canManage: false
        });
      }

      // Check credential verification status (key enhancement)
      const invalidStatuses = ['offline', 'error', 'loading', 'connecting'];
      if (!botData.credentialVerified || invalidStatuses.includes(botData.status)) {
        const reason = botData.invalidReason || 'Credentials need verification';
        console.log(`🔐 Bot needs credential verification - Status: ${botData.status}, CredVerified: ${botData.credentialVerified}, Reason: ${reason}`);
        return res.status(400).json({
          message: "Your bot credentials need to be updated before you can authenticate.",
          botStatus: "needs_credentials",
          nextStep: "update_credentials",
          needsCredentials: true,
          canManage: false,
          credentialUploadEndpoint: "/api/guest/verify-credentials"
        });
      }

      // Step 3: For verified bots, send OTP using stored credentials
      console.log(`✅ Bot is verified and approved - proceeding with OTP generation`);

      // Use stored credentials (already validated via credential verification system)
      let credentials = null;
      if (botData.credentials) {
        try {
          credentials = JSON.parse(JSON.stringify(botData.credentials));
          console.log(`🔑 Using verified stored credentials for ${cleanedPhone}`);
        } catch (error) {
          console.error(`❌ Invalid stored credentials format for ${cleanedPhone}:`, error);
          return res.status(500).json({
            message: "Stored credentials are corrupted. Please update your credentials.",
            botStatus: "needs_credentials",
            nextStep: "update_credentials",
            credentialUploadEndpoint: "/api/guest/verify-credentials"
          });
        }
      } else {
        console.error(`❌ No stored credentials found for verified bot ${cleanedPhone}`);
        return res.status(500).json({
          message: "No credentials found for verified bot. Please update your credentials.",
          botStatus: "needs_credentials",
          nextStep: "update_credentials",
          credentialUploadEndpoint: "/api/guest/verify-credentials"
        });
      }

      // Generate and send OTP via WhatsApp
      const otp = generateGuestOTP();
      createGuestSession(cleanedPhone, otp);

      const message = `🔐 Your verification code for bot management: ${otp}\n\nThis code expires in 10 minutes. Keep it secure!`;

      try {
        await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), message, true);

        console.log(`📱 OTP sent via WhatsApp to ${cleanedPhone}: ${otp}`);

        res.json({
          success: true,
          message: "Verification code sent to your WhatsApp",
          method: 'whatsapp',
          expiresIn: 600, // 10 minutes
          botStatus: "verified_approved",
          botId: botData.id,
          nextStep: "verify_otp",
          // For development/demo - remove in production
          ...(process.env.NODE_ENV === 'development' && { otp })
        });

      } catch (error) {
        console.error(`⚠️ Failed to send WhatsApp OTP to ${cleanedPhone}:`, error);

        // Log OTP for development/fallback
        console.log(`🔑 Guest OTP for ${cleanedPhone}: ${otp} (Display method - WhatsApp failed)`);

        res.json({
          success: true,
          message: "OTP generated but failed to send WhatsApp message. Check server logs for verification code.",
          method: 'display',
          expiresIn: 600, // 10 minutes
          botStatus: "verified_approved",
          botId: botData.id,
          nextStep: "verify_otp",
          // For development/demo - remove in production
          ...(process.env.NODE_ENV === 'development' && { otp })
        });
      }

    } catch (error) {
      console.error('Guest OTP send error:', error);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  // Guest Session Verification - Extract phone number from session ID and check bot status
  app.post("/api/guest/verify-session", async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      // Parse credentials from base64 encoded session ID (with TREKKER~ prefix support)
      let credentials;
      try {
        let base64Data = sessionId.trim();

        // Remove TREKKER~ prefix if present
        if (base64Data.startsWith('TREKKER~')) {
          console.log('🔍 Removing TREKKER~ prefix from session ID');
          base64Data = base64Data.substring(8); // Remove "TREKKER~" (8 characters)
        }

        // Check Base64 size limit (5MB when decoded)
        const estimatedSize = (base64Data.length * 3) / 4;
        const maxSizeBytes = 5 * 1024 * 1024; // 5MB

        if (estimatedSize > maxSizeBytes) {
          return res.status(400).json({
            message: `Session ID too large (estimated ${(estimatedSize / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.`
          });
        }

        // Decode the base64 data
        const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
        credentials = JSON.parse(decoded);

        // Validate Baileys v7 credentials
        const validation = validateBaileysCredentials(credentials);
        if (!validation.valid) {
          return res.status(400).json({
            message: `Invalid Baileys credentials: ${validation.error}`
          });
        }

        const credentialsSize = JSON.stringify(credentials).length;
        if (credentialsSize > maxSizeBytes) {
          return res.status(400).json({
            message: `Decoded session data too large (${(credentialsSize / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.`
          });
        }
      } catch (error) {
        return res.status(400).json({
          message: `Invalid session ID: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      // Use centralized phone number extraction (supports both LID and JID)
      const phoneNumber = extractPhoneNumber(credentials);

      if (!phoneNumber) {
        console.error('Failed to extract phone number from credentials:', {
          hasCredsMe: !!(credentials?.creds?.me),
          hasMe: !!(credentials?.me),
          credsKeys: credentials?.creds ? Object.keys(credentials.creds) : [],
          topLevelKeys: credentials ? Object.keys(credentials) : []
        });
        return res.status(400).json({
          message: "Cannot extract phone number from session credentials. Please ensure you're using valid WhatsApp session data."
        });
      }

      // Check if bot exists in global registry
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (!globalRegistration) {
        return res.status(404).json({ message: "No bot found with this phone number" });
      }

      const botServer = globalRegistration.tenancyName;
      const currentServer = getServerName();

      // Find bot directly in database using shared database access (preserves tenancy)
      const botInstance = await db.select()
        .from(botInstances)
        .where(
          and(
            eq(botInstances.phoneNumber, phoneNumber),
            eq(botInstances.serverName, botServer) // Use original tenancy
          )
        )
        .limit(1);

      if (botInstance.length === 0) {
        return res.status(404).json({ message: "Bot not found in database" });
      }

      const bot = botInstance[0];
      let botActive = false;

      // Check if bot is on current server for active status check
      if (botServer === currentServer) {
        // Check if bot is actually active/connected locally
        const botStatuses = botManager.getAllBotStatuses();
        botActive = botStatuses[bot.id] === 'online';
      }

      // Test credentials on current server and update in original tenancy if valid
      if (!botActive && credentials) {
        console.log(`🔄 Testing new credentials on current server for bot from ${botServer} (phone: ${phoneNumber})`);

        try {
          // Test connection with new credentials on current server
          const { validateCredentialsByPhoneNumber } = await import('./services/creds-validator');
          const testResult = await validateCredentialsByPhoneNumber(phoneNumber, credentials);

          if (testResult.isValid) {
            console.log(`✅ Connection test successful - updating credentials in ${botServer} tenancy`);

            // Direct database update preserving original tenancy
            const [updatedBot] = await db
              .update(botInstances)
              .set({
                credentials: credentials,
                credentialVerified: true,
                invalidReason: null,
                autoStart: true, // Re-enable auto-start when credentials are fixed
                status: 'loading',
                updatedAt: sql`CURRENT_TIMESTAMP`
              })
              .where(
                and(
                  eq(botInstances.phoneNumber, phoneNumber),
                  eq(botInstances.serverName, botServer) // Preserve original tenancy
                )
              )
              .returning();

            if (updatedBot) {
              console.log(`✅ Updated credentials for bot ${bot.id} in ${botServer} tenancy via direct database access`);

              // If bot is on current server, restart it with new credentials
              if (botServer === currentServer) {
                try {
                  await botManager.destroyBot(bot.id);
                  await botManager.createBot(bot.id, { ...updatedBot, credentials });
                  await botManager.startBot(bot.id);
                  botActive = true;
                  console.log(`✅ Bot restarted successfully on current server`);
                } catch (restartError) {
                  console.error(`❌ Failed to restart bot ${bot.id}:`, restartError);
                  await db
                    .update(botInstances)
                    .set({
                      status: 'error',
                      invalidReason: `Restart failed: ${restartError.message}`,
                      updatedAt: sql`CURRENT_TIMESTAMP`
                    })
                    .where(
                      and(
                        eq(botInstances.phoneNumber, phoneNumber),
                        eq(botInstances.serverName, botServer)
                      )
                    );
                }
              }

              // Log activity preserving original tenancy
              await storage.createCrossTenancyActivity({
                type: 'cross_server_credential_update',
                description: `Credentials tested on ${currentServer} and updated for bot on ${botServer}`,
                metadata: {
                  testServer: currentServer,
                  botServer: botServer,
                  botId: bot.id,
                  connectionTestSuccessful: testResult.isValid,
                  tenancyPreserved: true
                },
                serverName: botServer, // Log to original tenancy
                phoneNumber: phoneNumber,
                botInstanceId: bot.id,
                remoteTenancy: currentServer
              });

              // Send success message
              setTimeout(async () => {
                try {
                  const successMessage = `🎉 *Session Update Successful!* 🎉

Your TREKKER-MD bot "${bot.name}" has been successfully updated with new credentials!

📱 *Phone:* ${phoneNumber}
🆔 *JID:* ${bot.userJid}
🔐 *Update Details:*
• Bot Server: ${botServer}
• Status: ✅ Credentials Updated ${botServer === currentServer ? '& Reconnecting' : '& Saved'}
• Time: ${new Date().toLocaleString()}

${botServer === currentServer ? '🚀 Your bot will be online shortly!' : '🌐 Your bot credentials are updated on the hosting server.'}

Thank you for using TREKKER-MD! 🚀

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;

                  if (botServer === currentServer) {
                    // Try to send via the bot itself
                    const messageSent = await botManager.sendMessageThroughBot(bot.id, phoneNumber, successMessage);
                    if (!messageSent) {
                      await sendGuestValidationMessage(phoneNumber, JSON.stringify(credentials), successMessage, true);
                    }
                  } else {
                    // Send via validation bot since it's cross-server
                    await sendGuestValidationMessage(phoneNumber, JSON.stringify(credentials), successMessage, true);
                  }
                  console.log(`✅ Session update success message sent to ${phoneNumber}`);
                } catch (notificationError) {
                  console.error('Failed to send session update notification:', notificationError);
                }
              }, 3000);
            }
          } else {
            console.log(`❌ Connection test failed for ${phoneNumber}:`, testResult.message);
            // Update with test failure but preserve tenancy
            await db
              .update(botInstances)
              .set({
                credentialVerified: false,
                invalidReason: testResult.message || 'Connection test failed',
                status: 'offline',
                updatedAt: sql`CURRENT_TIMESTAMP`
              })
              .where(
                and(
                  eq(botInstances.phoneNumber, phoneNumber),
                  eq(botInstances.serverName, botServer)
                )
              );

            // Set validation failure flag for response
            botActive = false;
          }
        } catch (testError) {
          console.error(`❌ Error testing credentials for ${phoneNumber}:`, testError);
          await db
            .update(botInstances)
            .set({
              credentialVerified: false,
              invalidReason: `Credential test error: ${testError.message}`,
              status: 'offline',
              updatedAt: sql`CURRENT_TIMESTAMP`
            })
            .where(
              and(
                eq(botInstances.phoneNumber, phoneNumber),
                eq(botInstances.serverName, botServer)
              )
            );

          // Set validation failure flag for response
          botActive = false;
        }
      }

      // Generate guest token for future authenticated requests
      const token = generateGuestToken(phoneNumber, bot.id);

      // Get updated bot status after credential testing
      const updatedBotInstance = await db.select()
        .from(botInstances)
        .where(
          and(
            eq(botInstances.phoneNumber, phoneNumber),
            eq(botInstances.serverName, botServer)
          )
        )
        .limit(1);

      const updatedBot = updatedBotInstance[0] || bot;
      const credentialTestFailed = !updatedBot.credentialVerified && updatedBot.invalidReason;

      res.json({
        success: !credentialTestFailed, // Success if credentials didn't fail validation
        phoneNumber: `+${phoneNumber}`,
        botActive,
        botServer,
        crossServer: botServer !== currentServer,
        token,
        message: credentialTestFailed
          ? `Credential validation failed: ${updatedBot.invalidReason}`
          : botActive
            ? "Bot is active and connected"
            : "Credentials updated successfully and success message sent to WhatsApp",
        botId: bot.id,
        botName: bot.name,
        lastActivity: bot.lastActivity,
        connectionUpdated: credentials && !credentialTestFailed ? true : false,
        tenancyPreserved: true,
        updateMethod: 'direct_database_access',
        nextStep: !credentialTestFailed ? 'authenticated' : 'update_credentials',
        credentialValidationFailed: credentialTestFailed
      });

    } catch (error) {
      console.error('Guest session verification error:', error);
      res.status(500).json({ message: "Failed to verify session" });
    }
  });

  // Guest Bot Registration
  app.post("/api/guest/register-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      console.log('🎯 Guest bot registration request received');
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      const { botName, phoneNumber, credentialType, sessionId, features, selectedServer } = req.body;

      // Validate required fields
      if (!botName || !phoneNumber) {
        return res.status(400).json({
          success: false,
          message: "Bot name and phone number are required"
        });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Validate phone number format
      if (!/^\d{10,15}$/.test(cleanedPhone)) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number format. Please enter a valid phone number with country code."
        });
      }

      console.log(`📱 Processing registration for phone: ${cleanedPhone}`);
      console.log(`🎯 Target server: ${selectedServer || 'current server'}`);

      // Step 1: Check if phone number already exists in God Registry
      const existingRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      if (existingRegistration) {
        const hostingServer = existingRegistration.tenancyName;
        const currentServer = getServerName();

        console.log(`📍 Phone ${cleanedPhone} found in God Registry on server: ${hostingServer}`);

        if (hostingServer === currentServer) {
          // Phone exists on current server - check for existing bot
          const existingBot = await storage.getBotByPhoneNumber(cleanedPhone);
          if (existingBot) {
            console.log(`🤖 Existing bot found: ${existingBot.name}`);
            return res.json({
              success: false,
              type: 'existing_bot_found',
              message: `Welcome back! You already have a bot "${existingBot.name}" registered with this phone number.`,
              botDetails: maskBotDataForGuest(existingBot, true)
            });
          }
        } else {
          // Phone exists on different server - cannot register duplicate
          return res.status(400).json({
            success: false,
            message: `This phone number is already registered on ${hostingServer}. Each phone number can only be used once across all servers.`
          });
        }
      }

      // Step 2: Parse and validate credentials
      let credentials = null;
      if (credentialType === 'base64' && sessionId) {
        try {
          console.log(`🔍 SessionID received (length: ${sessionId?.length}):`, sessionId?.substring(0, 50) + '...');
          // Use centralized credential decoder (handles TREKKER~ prefix removal)
          credentials = decodeCredentials(sessionId);

          // Validate Baileys v7 credentials and get normalized version
          const validation = validateBaileysCredentials(credentials);
          if (!validation.valid) {
            return res.status(400).json({
              success: false,
              message: `Invalid Baileys credentials: ${validation.error}`
            });
          }

          // Use the normalized credentials (v7 format wrapped in creds object)
          credentials = validation.normalized || credentials;
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: `Invalid session ID: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      } else if (credentialType === 'file' && req.file) {
        try {
          credentials = JSON.parse(req.file.buffer.toString('utf-8'));

          // Validate Baileys v7 credentials and get normalized version
          const validation = validateBaileysCredentials(credentials);
          if (!validation.valid) {
            return res.status(400).json({
              success: false,
              message: `Invalid Baileys credentials: ${validation.error}`
            });
          }

          // Use the normalized credentials (v7 format wrapped in creds object)
          credentials = validation.normalized || credentials;
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: "Invalid credentials file format. Please upload a valid JSON file."
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: "Please provide credentials either as base64 session ID or upload a credentials file."
        });
      }

      // Step 3: Validate credentials structure and phone number ownership
      // Use centralized phone extraction (supports both LID and JID)
      let credentialsPhone = extractPhoneNumber(credentials);

      // Method 3: Deep search for phone numbers in credentials
      if (!credentialsPhone) {
        const findPhoneInObject = (obj: any, depth = 0): string | null => {
          if (depth > 5 || !obj || typeof obj !== 'object') return null;

          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
              // Look for patterns like "1234567890:x@s.whatsapp.net"
              const phoneMatch = value.match(/(\d{10,15}):/);
              if (phoneMatch) return phoneMatch[1];

              // Look for standalone phone numbers in phone-related fields
              if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('number')) {
                const cleanNumber = value.replace(/\D/g, '');
                if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
                  return cleanNumber;
                }
              }
            } else if (typeof value === 'object') {
              const found = findPhoneInObject(value, depth + 1);
              if (found) return found;
            }
          }
          return null;
        };

        credentialsPhone = findPhoneInObject(credentials);
      }

      if (!credentialsPhone || credentialsPhone !== cleanedPhone) {
        return res.status(400).json({
          success: false,
          message: `Credentials phone number mismatch. The session belongs to +${credentialsPhone || 'unknown'} but you provided +${cleanedPhone}.`
        });
      }

      console.log(`✅ Credentials validated for phone: ${cleanedPhone}`);

      // Step 4: Check if promotional offer is active
      const offerActive = await storage.isOfferActive();
      console.log(`🎁 Promotional offer status: ${offerActive ? 'ACTIVE' : 'inactive'}`);

      // Step 5: Prepare bot data with auto-approval if offer is active
      const parsedFeatures = typeof features === 'string' ? JSON.parse(features) : (features || {});

      // Note: serverName will be added dynamically based on target server selection
      const botData: any = {
        name: botName,
        phoneNumber: cleanedPhone,
        credentials,
        status: 'loading',
        approvalStatus: offerActive ? 'approved' : 'pending',
        autoLike: parsedFeatures.autoLike || false,
        autoViewStatus: parsedFeatures.autoView || false,
        autoReact: parsedFeatures.autoReact || false,
        chatgptEnabled: parsedFeatures.chatGPT || false,
        presenceMode: parsedFeatures.presenceMode || 'none',
        autoStart: true,
        credentialVerified: true,
        isGuest: true,
        messagesCount: 0,
        commandsCount: 0,
        expirationMonths: offerActive ? 1 : undefined, // Set default to 1 month if offer active
      };

      console.log(`📊 Bot data prepared:`, {
        name: botData.name,
        phone: botData.phoneNumber,
        features: {
          autoLike: botData.autoLike,
          autoReact: botData.autoReact,
          autoView: botData.autoViewStatus,
          chatGPT: botData.chatgptEnabled
        }
      });

      const currentServer = getServerName();

      // Step 5: Handle server selection - CRITICAL FIX
      if (selectedServer && selectedServer !== currentServer) {
        console.log(`🌍 Cross-server registration requested: ${currentServer} → ${selectedServer}`);

        // Verify target server exists and has capacity
        const targetServerInfo = await storage.getServerByName(selectedServer);
        if (!targetServerInfo) {
          return res.status(400).json({
            success: false,
            message: `Selected server "${selectedServer}" does not exist.`
          });
        }

        // Check target server capacity
        const targetCapacityCheck = await storage.strictCheckBotCountLimit(selectedServer);
        if (!targetCapacityCheck.canAdd) {
          return res.status(400).json({
            success: false,
            message: `Selected server "${selectedServer}" is at capacity (${targetCapacityCheck.currentCount}/${targetCapacityCheck.maxCount}). Please choose a different server.`
          });
        }

        console.log(`✅ Target server ${selectedServer} has capacity: ${targetCapacityCheck.currentCount}/${targetCapacityCheck.maxCount}`);

        // Perform cross-server registration to selected server
        const crossServerResult = await storage.createCrossServerRegistration(
          cleanedPhone,
          selectedServer,
          botData
        );

        if (!crossServerResult.success) {
          return res.status(500).json({
            success: false,
            message: crossServerResult.error || "Cross-server registration failed"
          });
        }

        console.log(`✅ Bot successfully registered on selected server: ${selectedServer}`);

        // Send success message to the user via WhatsApp
        try {
          if (credentials) {
            const validationMessage = offerActive
              ? `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone:${cleanedPhone}
📅 ${new Date().toLocaleString()}
🏢 Server: ${selectedServer}
✅ Bot is now registered on ${selectedServer} and awaiting admin approval.

🎁 PROMOTIONAL OFFER ACTIVE!
✨ Your bot has been AUTO-APPROVED!
🚀 Your bot is now LIVE and ready to use!

Enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`
              : `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}

⏳ Status: Awaiting admin approval
📞 Contact: +254704897825 for activation

🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;

            await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), validationMessage, true);
            console.log(`✅ Registration success message sent to ${cleanedPhone} on ${selectedServer}`);
          }
        } catch (messageError) {
          console.error('Failed to send registration success message:', messageError);
        }

        return res.json({
          success: true,
          type: 'cross_tenancy_registered',
          message: `Registration successful! Your bot has been registered on ${selectedServer} as requested.`,
          botDetails: maskBotDataForGuest(crossServerResult.botInstance!, true),
          originalServer: currentServer,
          assignedServer: selectedServer,
          availableSlots: targetServerInfo.maxBotCount - targetServerInfo.currentBotCount - 1,
          serverUrl: targetServerInfo.serverUrl,
          nextSteps: [
            `Your bot "${botName}" is now registered on ${selectedServer}`,
            `Contact +254704897825 to activate your bot`,
            `Once approved, you can manage your bot from any server`,
            `Cross-server management ensures the best performance`
          ]
        });
      }

      // Register bot on current server (when no specific server selected or current server selected)
      console.log(`📝 Registering bot on current server: ${currentServer}`);

      // Check current server capacity
      const capacityCheck = await storage.strictCheckBotCountLimit();
      if (!capacityCheck.canAdd) {
        console.log(`🚫 Current server ${currentServer} is at capacity`);

        // Server is full - attempt auto-assignment to available server
        const availableServers = await storage.getAvailableServers();
        if (availableServers.length === 0) {
          return res.status(400).json({
            success: false,
            message: `All servers are at capacity. Please try again later or contact support.`,
            serverFull: true,
            allServersFull: true
          });
        }

        // Select the server with the most available slots
        const targetServer = availableServers.reduce((prev, current) => {
          const prevAvailable = prev.maxBotCount - (prev.currentBotCount || 0);
          const currentAvailable = current.maxBotCount - (current.currentBotCount || 0);
          return currentAvailable > prevAvailable ? current : prev;
        });

        console.log(`🌍 Auto-selecting target server: ${targetServer.serverName}`);

        // Perform cross-server registration
        const crossServerResult = await storage.createCrossServerRegistration(
          cleanedPhone,
          targetServer.serverName,
          botData
        );

        if (!crossServerResult.success) {
          return res.status(500).json({
            success: false,
            message: crossServerResult.error || "Cross-server registration failed"
          });
        }

        console.log(`✅ Bot successfully auto-assigned to ${targetServer.serverName}`);

        // Send success message to the user via WhatsApp
        try {
          if (credentials) {
            const validationMessage = offerActive
              ? `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}
🏢 Server: ${targetServer.serverName} (Auto-assigned)

🎁 PROMOTIONAL OFFER ACTIVE!
✨ Your bot has been AUTO-APPROVED!
🚀 Your bot is now LIVE and ready to use!

Enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`
              : `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}

⏳ Status: Awaiting admin approval
📞 Contact: +254704897825 for activation

🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;

            await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), validationMessage, true);
            console.log(`✅ Registration success message sent to ${cleanedPhone} on ${targetServer.serverName}`);
          }
        } catch (messageError) {
          console.error('Failed to send registration success message:', messageError);
        }

        return res.json({
          success: true,
          type: 'cross_tenancy_registered',
          message: `Registration successful! Your bot has been automatically assigned to ${targetServer.serverName} for optimal performance.`,
          botDetails: maskBotDataForGuest(crossServerResult.botInstance!, true),
          originalServer: currentServer,
          assignedServer: targetServer.serverName,
          availableSlots: targetServer.maxBotCount - (targetServer.currentBotCount || 0) - 1,
          serverUrl: targetServer.serverUrl,
          nextSteps: [
            `Your bot "${botName}" is now registered on ${targetServer.serverName}`,
            `Contact +254704897825 to activate your bot`,
            `Once approved, you can manage your bot from any server`,
            `Cross-server management ensures the best performance`
          ]
        });
      }

      // Add to global registration first
      await storage.addGlobalRegistration(cleanedPhone, currentServer);

      // Create bot instance on current server
      const newBot = await storage.createBotInstance(botData);

      console.log(`✅ Bot registered successfully:`, {
        botId: newBot.id,
        name: newBot.name,
        server: currentServer,
        status: newBot.status,
        autoApproved: offerActive
      });

      // Auto-start bot if auto-approved (promotional offer active)
      if (offerActive) {
        try {
          console.log(`🚀 AUTO-START POLICY: Starting auto-approved bot ${newBot.name} (${newBot.id})...`);
          await botManager.createBot(newBot.id, newBot);
          await botManager.startBot(newBot.id);

          // Wait for bot to initialize before sending approval message
          setTimeout(async () => {
            try {
              const approvalMessage = `╔══════════════════════════════════════════╗
║ 🎉        TREKKER-MD APPROVAL        🎉   ║
╠══════════════════════════════════════════╣
║ ✅ Bot "${newBot.name}" is now ACTIVE!           ║
║ 📱 Phone: ${cleanedPhone}                    ║
║ 📅 Approved: ${new Date().toLocaleDateString()}                    ║
║ ⏳ Valid: ${newBot.expirationMonths || 3} Months                       ║
╠══════════════════════════════════════════╣
║ 🚀 Features Enabled:                      ║
║ • Automation & ChatGPT                    ║
║ • Auto-like / Auto-react                  ║
║ • Status Viewing                          ║
╠══════════════════════════════════════════╣
║ 🔥 Thank you for choosing TREKKER-MD!     ║
╚══════════════════════════════════════════╝`;

              // Send approval notification using the bot's own credentials
              const messageSent = await botManager.sendMessageThroughBot(newBot.id, cleanedPhone, approvalMessage);

              if (messageSent) {
                console.log(`✅ Auto-approval notification sent to ${cleanedPhone} via bot ${newBot.name}`);
              } else {
                console.log(`⚠️ Failed to send approval notification to ${cleanedPhone} - bot might not be online yet, trying validation bot`);
                // Fallback to validation bot if bot isn't ready yet
                await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), approvalMessage, true);
              }
            } catch (notificationError) {
              console.error('Failed to send auto-approval notification:', notificationError);
            }
          }, 5000); // Wait 5 seconds for bot to fully initialize

        } catch (startError) {
          console.error(`Failed to auto-start bot ${newBot.id}:`, startError);
          // Update status to error if start failed
          await storage.updateBotInstance(newBot.id, { status: 'error' });
        }
      } else {
        // Send registration pending message for non-auto-approved bots
        try {
          if (credentials) {
            const validationMessage = `🎉 TREKKER-MD BOT REGISTRATION 🎉

✅ Bot "${botName}" registered successfully!
📱 Phone: ${cleanedPhone}
📅 ${new Date().toLocaleString()}

⏳ Status: Awaiting admin approval
📞 Contact: +254704897825 for activation

🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;

            await sendGuestValidationMessage(cleanedPhone, JSON.stringify(credentials), validationMessage, true);
            console.log(`✅ Registration pending message sent to ${cleanedPhone}`);
          }
        } catch (messageError) {
          console.error('Failed to send registration pending message:', messageError);
        }
      }

      res.json({
        success: true,
        message: offerActive
          ? "🎁 Your TREKKER-MD bot has been auto-approved and is now LIVE! Enjoy the promotional offer!"
          : "Your TREKKER-MD bot has been registered successfully and is awaiting admin approval!",
        botDetails: maskBotDataForGuest(newBot, true),
        botId: newBot.id
      });

    } catch (error) {
      console.error('Guest bot registration error:', error);

      // Enhanced error handling with specific messages
      let userMessage = "Registration failed. Please try again.";

      if (error instanceof Error) {
        if (error.message.includes('already registered')) {
          userMessage = "This phone number is already registered. Each phone can only be used once.";
        } else if (error.message.includes('capacity') || error.message.includes('full')) {
          userMessage = "Server capacity reached. Please try again later.";
        } else if (error.message.includes('credentials')) {
          userMessage = "Invalid credentials provided. Please check your session ID or file.";
        }
      }

      res.status(500).json({
        success: false,
        message: userMessage
      });
    }
  });

  // Get available servers for registration
  app.get("/api/servers/available", async (req, res) => {
    try {
      const availableServers = await storage.getAvailableServers();

      const serverList = availableServers.map(server => ({
        id: server.serverName, // Use serverName as ID for compatibility
        name: server.serverName, // This is what should be sent as selectedServer
        description: server.description || `Server ${server.serverName} - Available for new bots`,
        currentBots: server.currentBotCount || 0,
        maxBots: server.maxBotCount,
        availableSlots: server.maxBotCount - (server.currentBotCount || 0),
        serverUrl: server.serverUrl
      }));

      res.json({
        servers: serverList,
        count: serverList.length
      });
    } catch (error) {
      console.error('Available servers error:', error);
      res.status(500).json({ message: "Failed to fetch available servers" });
    }
  });

  // ======= CROSS-TENANCY MANAGEMENT =======

  // Authentication middleware for cross-tenancy requests
  const authenticateCrossTenancy = async (req: any, res: any, next: any) => {
    try {
      const authHeader = req.headers.authorization;
      const sourceServer = req.headers['x-source-server'];
      const targetServer = req.headers['x-target-server'];

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Missing or invalid authorization header'
        });
      }

      if (!sourceServer || !targetServer) {
        return res.status(400).json({
          success: false,
          error: 'Missing X-Source-Server or X-Target-Server headers'
        });
      }

      // Validate that target server is current server
      const currentServer = getServerName();
      if (targetServer !== currentServer) {
        return res.status(403).json({
          success: false,
          error: `Request target ${targetServer} does not match current server ${currentServer}`
        });
      }

      // Validate that source server exists and has a shared secret configured
      const sourceServerInfo = await storage.getServerByName(sourceServer);
      if (!sourceServerInfo) {
        return res.status(404).json({
          success: false,
          error: `Source server ${sourceServer} not found in registry`
        });
      }

      if (!sourceServerInfo.sharedSecret) {
        return res.status(403).json({
          success: false,
          error: `Source server ${sourceServer} has no shared secret configured`
        });
      }

      // Validate JWT token
      const token = authHeader.substring(7);
      const payload = CrossTenancyClient.validateToken(token, sourceServer, sourceServerInfo.sharedSecret);

      if (!payload) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token'
        });
      }

      // Attach validated payload to request
      req.crossTenancy = payload;
      req.sourceServer = sourceServer;
      req.targetServer = targetServer;

      next();
    } catch (error) {
      console.error('Cross-tenancy authentication error:', error);
      res.status(500).json({
        success: false,
        error: 'Authentication failed'
      });
    }
  };

  // Zod schemas for validation
  const botCreateSchema = z.object({
    botData: z.object({
      name: z.string().min(1),
      phoneNumber: z.string().optional(),
      status: z.string().default('offline'),
      credentials: z.any().optional(),
      settings: z.any().default({}),
      autoLike: z.boolean().default(true),
      autoViewStatus: z.boolean().default(true),
      autoReact: z.boolean().default(true),
      typingMode: z.string().default('recording'),
      chatgptEnabled: z.boolean().default(false),
      approvalStatus: z.string().default('pending'),
      isGuest: z.boolean().default(false),
      autoStart: z.boolean().default(true),
      credentialVerified: z.boolean().default(false),
    }),
    phoneNumber: z.string().min(1),
  });

  const botUpdateSchema = z.object({
    botId: z.string().min(1),
    updates: z.object({}).passthrough(),
  });

  const botCredentialUpdateSchema = z.object({
    botId: z.string().min(1),
    credentialData: z.object({
      credentialVerified: z.boolean(),
      credentialPhone: z.string().optional(),
      invalidReason: z.string().optional(),
      credentials: z.any().optional(),
    }),
  });

  const botLifecycleSchema = z.object({
    botId: z.string().min(1),
    action: z.enum(['start', 'stop', 'restart']),
  });

  // Health check endpoint
  app.post("/internal/tenants/bots/health", authenticateCrossTenancy, (req: any, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        serverName: getServerName(),
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    });
  });

  // Create bot endpoint
  app.post("/internal/tenants/bots/create", authenticateCrossTenancy, async (req: any, res) => {
    try {
      const validation = botCreateSchema.safeParse(req.crossTenancy.data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: validation.error.issues,
        });
      }

      const { botData, phoneNumber } = validation.data;

      // Create bot instance on current server
      const botInstance = await storage.createBotInstance({
        ...botData,
        serverName: getServerName(), // Ensure server isolation
      });

      // Add to global registry
      await storage.addGlobalRegistration(phoneNumber, getServerName());

      // Log cross-tenancy activity
      await storage.createCrossTenancyActivity({
        type: 'cross_tenancy_bot_create',
        description: `Bot created via cross-tenancy request from ${req.sourceServer}`,
        metadata: {
          sourceServer: req.sourceServer,
          botId: botInstance.id,
          phoneNumber
        },
        serverName: getServerName(),
        botInstanceId: botInstance.id,
        remoteTenancy: req.sourceServer,
      });

      res.json({
        success: true,
        data: botInstance,
        message: 'Bot created successfully',
      });

    } catch (error) {
      console.error('Cross-tenancy bot creation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create bot',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Update bot endpoint
  app.post("/internal/tenants/bots/update", authenticateCrossTenancy, async (req: any, res) => {
    try {
      const validation = botUpdateSchema.safeParse(req.crossTenancy.data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: validation.error.issues,
        });
      }

      const { botId, updates } = validation.data;

      // Update bot instance (storage automatically scopes by serverName)
      const botInstance = await storage.updateBotInstance(botId, updates);

      // Log cross-tenancy activity
      await storage.createCrossTenancyActivity({
        type: 'cross_tenancy_bot_update',
        description: `Bot updated via cross-tenancy request from ${req.sourceServer}`,
        metadata: {
          sourceServer: req.sourceServer,
          botId,
          updates
        },
        serverName: getServerName(),
        botInstanceId: botId,
        remoteTenancy: req.sourceServer,
      });

      res.json({
        success: true,
        data: botInstance,
        message: 'Bot updated successfully',
      });

    } catch (error) {
      console.error('Cross-tenancy bot update error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update bot',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Update bot credentials endpoint
  app.post("/internal/tenants/bots/credentials", authenticateCrossTenancy, async (req: any, res) => {
    try {
      const validation = botCredentialUpdateSchema.safeParse(req.crossTenancy.data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: validation.error.issues,
        });
      }

      const { botId, credentialData } = validation.data;

      // Update bot credentials (storage automatically scopes by serverName)
      const botInstance = await storage.updateBotCredentialStatus(botId, credentialData);

      // Log cross-tenancy activity
      await storage.createCrossTenancyActivity({
        type: 'cross_tenancy_credential_update',
        description: `Bot credentials updated via cross-tenancy request from ${req.sourceServer}`,
        metadata: {
          sourceServer: req.sourceServer,
          botId,
          credentialVerified: credentialData.credentialVerified
        },
        serverName: getServerName(),
        botInstanceId: botId,
        remoteTenancy: req.sourceServer,
      });

      res.json({
        success: true,
        data: botInstance,
        message: 'Bot credentials updated successfully',
      });

    } catch (error) {
      console.error('Cross-tenancy credential update error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update bot credentials',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Bot lifecycle control endpoint
  app.post("/internal/tenants/bots/lifecycle", authenticateCrossTenancy, async (req: any, res) => {
    try {
      const validation = botLifecycleSchema.safeParse(req.crossTenancy.data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: validation.error.issues,
        });
      }

      const { botId, action } = validation.data;

      // Verify bot exists and is on current server
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        return res.status(404).json({
          success: false,
          error: 'Bot not found',
        });
      }

      let result;
      switch (action) {
        case 'start':
          await botManager.startBot(botId);
          result = { status: 'starting' };
          break;
        case 'stop':
          await botManager.stopBot(botId);
          result = { status: 'stopped' };
          break;
        case 'restart':
          await botManager.restartBot(botId);
          result = { status: 'restarting' };
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Log cross-tenancy activity
      await storage.createCrossTenancyActivity({
        type: 'cross_tenancy_bot_lifecycle',
        description: `Bot ${action} action via cross-tenancy request from ${req.sourceServer}`,
        metadata: {
          sourceServer: req.sourceServer,
          botId,
          action
        },
        serverName: getServerName(),
        botInstanceId: botId,
        remoteTenancy: req.sourceServer,
      });

      res.json({
        success: true,
        data: result,
        message: `Bot ${action} action completed successfully`,
      });

    } catch (error) {
      console.error(`Cross-tenancy bot lifecycle error:`, error);
      res.status(500).json({
        success: false,
        error: `Failed to ${req.crossTenancy.data.action} bot`,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Get bot status endpoint
  app.post("/internal/tenants/bots/status", authenticateCrossTenancy, async (req: any, res) => {
    try {
      const { botId } = req.crossTenancy.data;

      if (!botId || typeof botId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Bot ID is required',
        });
      }

      // Get bot instance (storage automatically scopes by serverName)
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        return res.status(404).json({
          success: false,
          error: 'Bot not found',
        });
      }

      // Get bot runtime status from bot manager
      const bot = botManager.getBot(botId);
      const runtimeStatus = bot ? bot.getStatus() : 'offline';

      res.json({
        success: true,
        data: {
          status: botInstance.status,
          isOnline: runtimeStatus === 'online',
          runtimeStatus,
          lastActivity: botInstance.lastActivity,
        },
        message: 'Bot status retrieved successfully',
      });

    } catch (error) {
      console.error('Cross-tenancy bot status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get bot status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return httpServer;
}


// Pairing code generation endpoint
// This endpoint is now handled by the dedicated /api/guest/auth/send-otp endpoint or cross-tenancy registration flows.
// The original /api/pairing/code endpoint was removed as it was redundant and caused conflicts.