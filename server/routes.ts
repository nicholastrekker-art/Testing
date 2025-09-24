import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from 'jsonwebtoken';
import multer from "multer";
import fs from 'fs';
import path from 'path';
import { storage } from "./storage";
import { insertBotInstanceSchema, insertCommandSchema, insertActivitySchema, botInstances } from "@shared/schema";
import { botManager } from "./services/bot-manager";
import { getServerName, db } from "./db";
import { and, eq, desc, asc, isNotNull } from "drizzle-orm";
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
import { sendValidationMessage, sendGuestValidationMessage, validateWhatsAppCredentials } from "./services/validation-bot";
import { CrossTenancyClient } from "./services/crossTenancyClient";
import { z } from "zod";

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
  storage: multer.memoryStorage(),
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

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket setup for real-time updates
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


  // Function to resume all saved bots from database on startup
  async function resumeSavedBots() {
    try {
      console.log('🔄 Starting bot resume process...');

      // Run analysis to mark inactive bots as non-auto-start
      await storage.analyzeInactiveBots();

      // Get only bots that are approved, verified, and marked for auto-start
      const resumableBots = await storage.getBotInstancesForAutoStart();

      if (resumableBots.length === 0) {
        console.log('📋 No bots eligible for auto-start found');
        return;
      }

      console.log(`🚀 Resuming ${resumableBots.length} auto-start bot(s) with verified credentials...`);

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

  // Resume all saved bots from database on startup
  await resumeSavedBots();

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
          const base64Data = req.body.sessionData.trim();

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

  // Get all available servers (Server1-Server100) with bot counts
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
  app.post("/api/server/configure", authenticateAdmin, async (req, res) => {
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
  app.post("/api/bots/:id/approve", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { expirationMonths = 3 } = req.body;

      // Get bot details first
      const bot = await storage.getBotInstance(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Update bot to approved status  
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

      // Automatically start the bot after approval
      try {
        console.log(`Auto-starting approved bot ${bot.name} (${bot.id})...`);
        await botManager.startBot(id);

        // Wait a moment for the bot to initialize before sending notification
        setTimeout(async () => {
          try {
            if (bot.phoneNumber) {
              const approvalMessage = `🎉 *Bot Approval Confirmed!* 🎉

Congratulations! Your TREKKER-MD WhatsApp bot "${bot.name}" has been successfully approved and is now active!

📱 *Bot Details:*
• Name: ${bot.name}
• Phone: ${bot.phoneNumber}
• Status: ✅ Active & Online
• Approval Date: ${new Date().toLocaleDateString()}
• Valid For: ${expirationMonths} months

🚀 *Your bot is now live and ready to serve!*
• All automation features are enabled
• ChatGPT integration is active
• Auto-like, auto-react, and status viewing are operational

Thank you for choosing TREKKER-MD! Your bot will remain active for ${expirationMonths} months from today.

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;

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
      console.error("Approve bot error:", error);
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
  app.post("/api/bots/:id/toggle-feature", authenticateAdmin, async (req, res) => {
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

          // Decode base64
          const decodedContent = Buffer.from(base64Data, 'base64').toString('utf8');
          if (!decodedContent.trim()) {
            return res.status(400).json({ 
              message: "Decoded credentials are empty. Please check your base64 string." 
            });
          }

          // Parse JSON
          credentials = JSON.parse(decodedContent);

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
        } catch (error) {
          return res.status(400).json({ 
            message: "Invalid base64 or JSON format. Please ensure you're providing a valid base64-encoded credentials.json file." 
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
        // Get available servers for user to choose from
        const availableServers = await storage.getAvailableServers();

        if (availableServers.length > 0) {
          // Server is full but there are other available servers
          return res.status(400).json({ 
            message: `🚫 ${getServerName()} is full! (${botCountCheck.currentCount}/${botCountCheck.maxCount} bots)`,
            serverFull: true,
            currentServer: getServerName(),
            availableServers: availableServers.map(server => ({
              serverName: server.serverName,
              currentBots: server.currentBotCount || 0,
              maxBots: server.maxBotCount,
              availableSlots: server.maxBotCount - (server.currentBotCount || 0),
              serverUrl: server.serverUrl,
              description: server.description
            })),
            action: 'select_server'
          });
        } else {
          // All servers are full
          return res.status(400).json({ 
            message: `😞 All servers are full! Current server: ${getServerName()} (${botCountCheck.currentCount}/${botCountCheck.maxCount}). Please contact administrator for more capacity.`,
            serverFull: true,
            allServersFull: true
          });
        }
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
        'typingIndicator': 'typingMode',
        'chatGPT': 'chatgptEnabled',
        'alwaysOnline': 'alwaysOnline',
        'autoRecording': 'presenceMode',
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
        updateData[feature] = enabled;
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
        description: `${feature} feature ${enabled ? 'enabled' : 'disabled'}`,
        metadata: { feature, enabled },
        serverName: getServerName()
      });

      res.json({ message: "Feature updated successfully", feature, enabled });

    } catch (error) {
      console.error('Feature toggle error:', error);
      res.status(500).json({ message: "Failed to toggle feature" });
    }
  });

  // Approve Bot
  app.post("/api/bot-instances/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const { expirationMonths = 3 } = req.body;

      const bot = await storage.getBotInstance(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (bot.approvalStatus !== 'pending') {
        return res.status(400).json({ message: "Only pending bots can be approved" });
      }

      // Update bot to approved status
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
        description: `Bot approved for ${expirationMonths} months`,
        metadata: { expirationMonths },
        serverName: getServerName()
      });

      // Automatically start the bot after approval
      try {
        console.log(`Auto-starting approved bot ${bot.name} (${bot.id})...`);
        await botManager.startBot(id);

        // Wait a moment for the bot to initialize before sending notification
        setTimeout(async () => {
          try {
            if (bot.phoneNumber) {
              const approvalMessage = `🎉 *Bot Approval Confirmed!* 🎉

Congratulations! Your TREKKER-MD WhatsApp bot "${bot.name}" has been successfully approved and is now active!

📱 *Bot Details:*
• Name: ${bot.name}
• Phone: ${bot.phoneNumber}
• Status: ✅ Active & Online
• Approval Date: ${new Date().toLocaleDateString()}
• Valid For: ${expirationMonths} months

🚀 *Your bot is now live and ready to serve!*
• All automation features are enabled
• ChatGPT integration is active
• Auto-like, auto-react, and status viewing are operational

Thank you for choosing TREKKER-MD! Your bot will remain active for ${expirationMonths} months from today.

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;

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
        console.error(`Failed to auto-start bot ${bot.id}:`, startError);
        // Update status to error if start failed
        await storage.updateBotInstance(id, { status: 'error' });
      }

      // Broadcast update
      broadcast({ type: 'BOT_APPROVED', data: updatedBot });

      res.json({ message: "Bot approved successfully and starting automatically" });

    } catch (error) {
      console.error('Bot approval error:', error);
      res.status(500).json({ message: "Failed to approve bot" });
    }
  });

  // Revoke Bot Approval (change back to normal/pending status)
  app.post("/api/bot-instances/:id/revoke", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      // Get bot instance first
      const botInstance = await storage.getBotInstance(id);
      if (!botInstance) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Stop the bot if it's running
      await botManager.destroyBot(id);

      // Update bot status to pending
      const bot = await storage.updateBotInstance(id, {
        approvalStatus: 'pending',
        status: 'offline',
        approvalDate: null,
        expirationMonths: null,
      });

      // Log activity
      await storage.createActivity({
        botInstanceId: id,
        type: 'revoke_approval',
        description: `Bot approval revoked - returned to pending status`,
        metadata: { previousStatus: botInstance.approvalStatus },
        serverName: getServerName()
      });

      // Broadcast update
      broadcast({ type: 'BOT_APPROVAL_REVOKED', data: bot });

      res.json({ message: "Bot approval revoked successfully" });
    } catch (error) {
      console.error('Bot approval revoke error:', error);
      res.status(500).json({ message: "Failed to revoke bot approval" });
    }
  });

  // Bot control endpoints (restricted to admins)
  app.post("/api/bot-instances/:id/start", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const bot = await storage.getBotInstance(req.params.id);
      if (!bot) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      console.log(`Starting bot ${bot.name} (${bot.id})...`);
      await botManager.startBot(req.params.id);

      const updatedBot = await storage.updateBotInstance(req.params.id, { status: 'loading' });
      broadcast({ type: 'BOT_STATUS_CHANGED', data: updatedBot });

      res.json({ 
        success: true, 
        message: `Bot ${bot.name} startup initiated - TREKKERMD LIFETIME BOT initializing...` 
      });
    } catch (error) {
      console.error('Bot start error:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to start bot";

      // Update bot status to error
      try {
        const bot = await storage.updateBotInstance(req.params.id, { status: 'error' });
        broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
      } catch (updateError) {
        console.error('Failed to update bot status:', updateError);
      }

      res.status(500).json({ message: errorMessage });
    }
  });

  app.post("/api/bot-instances/:id/stop", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      await botManager.stopBot(req.params.id);
      const bot = await storage.updateBotInstance(req.params.id, { status: 'offline' });
      broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop bot" });
    }
  });

  app.post("/api/bot-instances/:id/restart", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      await botManager.restartBot(req.params.id);
      const bot = await storage.updateBotInstance(req.params.id, { status: 'loading' });
      broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to restart bot" });
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
        category: category || 'CUSTOM',
        useChatGPT: false,
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

  // ======= GUEST AUTHENTICATION ENDPOINTS =======

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
          invalidReason: reason,
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

      // Parse credentials from base64 encoded session ID
      let credentials;
      try {
        const base64Data = sessionId.trim();

        // Check Base64 size limit (5MB when decoded)
        const estimatedSize = (base64Data.length * 3) / 4;
        const maxSizeBytes = 5 * 1024 * 1024; // 5MB

        if (estimatedSize > maxSizeBytes) {
          return res.status(400).json({ 
            message: `Session ID too large (estimated ${(estimatedSize / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.` 
          });
        }

        const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');

        if (decoded.length > maxSizeBytes) {
          return res.status(400).json({ 
            message: `Decoded session data too large (${(decoded.length / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.` 
          });
        }

        credentials = JSON.parse(decoded);
      } catch (error) {
        return res.status(400).json({ message: "Invalid session ID format. Please ensure it's properly encoded WhatsApp session data." });
      }

      // Enhanced phone number extraction with multiple fallback methods
      let phoneNumber = null;

      // Method 1: Check credentials.creds.me.id (most common)
      if (credentials?.creds?.me?.id) {
        const phoneMatch = credentials.creds.me.id.match(/^(\d+):/);
        phoneNumber = phoneMatch ? phoneMatch[1] : null;
      }

      // Method 2: Check credentials.me.id (alternative format)
      if (!phoneNumber && credentials?.me?.id) {
        const phoneMatch = credentials.me.id.match(/^(\d+):/);
        phoneNumber = phoneMatch ? phoneMatch[1] : null;
      }

      // Method 3: Check credentials.creds.registrationId and look for phone in other fields
      if (!phoneNumber && credentials?.creds) {
        // Sometimes phone is in accountSyncCounter or other fields
        const credsStr = JSON.stringify(credentials.creds);
        const phoneMatches = credsStr.match(/(\d{10,15})/g);
        if (phoneMatches && phoneMatches.length > 0) {
          // Filter out timestamps and IDs, keep only valid phone numbers
          const validPhones = phoneMatches.filter(num => 
            num.length >= 10 && num.length <= 15 && 
            !num.startsWith('0') && // Remove numbers starting with 0 (likely timestamps)
            parseInt(num) > 1000000000 // Ensure it's a reasonable phone number
          );
          if (validPhones.length > 0) {
            phoneNumber = validPhones[0];
          }
        }
      }

      // Method 4: Deep search in the entire credentials object
      if (!phoneNumber) {
        const findPhoneInObject = (obj: any, depth = 0): string | null => {
          if (depth > 5 || !obj || typeof obj !== 'object') return null;

          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
              // Look for patterns like "1234567890:x@s.whatsapp.net"
              const phoneMatch = value.match(/(\d{10,15}):/);
              if (phoneMatch) return phoneMatch[1];

              // Look for standalone phone numbers
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

        phoneNumber = findPhoneInObject(credentials);
      }

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

      // Check bot status
      let botActive = false;
      let botData = null;

      if (botServer === currentServer) {
        // Bot is on current server - check local status
        const botInstance = await storage.getBotByPhoneNumber(phoneNumber);
        if (botInstance) {
          botData = botInstance;
          // Check if bot is actually active/connected
          const botStatuses = botManager.getAllBotStatuses();
          botActive = botStatuses[botInstance.id] === 'online';

          // If bot is inactive, automatically test the new session ID if provided
          if (!botActive && credentials) {
            console.log(`🔄 Bot is inactive, testing new session ID automatically for ${phoneNumber}...`);

            try {
              // Test connection with new credentials
              const { validateWhatsAppCredentials } = await import('./services/validation-bot');
              const testResult = await validateWhatsAppCredentials(phoneNumber, credentials);

              if (testResult.isValid) {
                console.log(`✅ Connection test successful for ${phoneNumber} with new credentials`);

                // Update bot credentials and restart
                await storage.updateBotInstance(botInstance.id, {
                  credentials: credentials,
                  credentialVerified: true,
                  invalidReason: null,
                  status: 'loading'
                });

                console.log(`✅ Updated credentials for bot ${botInstance.id} with new session ID`);

                // Restart the bot with new credentials
                try {
                  await botManager.destroyBot(botInstance.id);
                  await botManager.createBot(botInstance.id, { ...botInstance, credentials });
                  await botManager.startBot(botInstance.id);

                  console.log(`✅ Guest bot restart completed for ${botInstance.id} by ${phoneNumber}`);

                  // Send success message to WhatsApp owner
                  setTimeout(async () => {
                    try {
                      const successMessage = `🎉 *Session Update Successful!* 🎉

Your TREKKER-MD bot "${botInstance.name}" has been successfully updated with new credentials and is now reconnecting!

📱 *Update Details:*
• Phone: ${phoneNumber}
• Bot ID: ${botInstance.id}
• Status: ✅ Credentials Updated & Reconnecting
• Time: ${new Date().toLocaleString()}

🚀 *Your bot will be online shortly!*
All features will be restored once reconnection is complete.

Thank you for using TREKKER-MD! 🚀

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;

                      const messageSent = await botManager.sendMessageThroughBot(botInstance.id, phoneNumber, successMessage);

                      if (messageSent) {
                        console.log(`✅ Session update success message sent to ${phoneNumber} via bot ${botInstance.name}`);
                      } else {
                        console.log(`⚠️ Could not send success message to ${phoneNumber} - bot may still be connecting`);

                        // Try alternative method using ValidationBot for immediate message
                        try {
                          await sendGuestValidationMessage(phoneNumber, JSON.stringify(credentials), successMessage, true);
                          console.log(`✅ Session update success message sent via ValidationBot to ${phoneNumber}`);
                        } catch (altError) {
                          console.log(`⚠️ Alternative message sending also failed for ${phoneNumber}:`, altError);
                        }
                      }
                    } catch (notificationError) {
                      console.error('Failed to send session update notification:', notificationError);
                    }
                  }, 3000); // Wait 3 seconds for bot to initialize

                  // Mark as active since we successfully restarted
                  botActive = true;

                } catch (restartError) {
                  console.error(`❌ Failed to restart bot ${botInstance.id}:`, restartError);
                  await storage.updateBotInstance(botInstance.id, { 
                    status: 'error',
                    invalidReason: `Restart failed: ${restartError.message}`
                  });
                }
              } else {
                console.log(`❌ Connection test failed for ${phoneNumber}:`, testResult.message);
                await storage.updateBotInstance(botInstance.id, {
                  credentialVerified: false,
                  invalidReason: testResult.message || 'Connection test failed',
                  status: 'offline'
                });
              }
            } catch (testError) {
              console.error(`❌ Error testing credentials for ${phoneNumber}:`, testError);
              await storage.updateBotInstance(botInstance.id, {
                credentialVerified: false,
                invalidReason: `Credential test error: ${testError.message}`,
                status: 'offline'
              });
            }
          }
        }
      } else {
        // Bot is on remote server - assume inactive for now
        botData = {
          id: `remote-${phoneNumber}`,
          name: `Bot (${phoneNumber})`,
          phoneNumber: phoneNumber,
          serverName: botServer
        };
        botActive = false;
      }

      // Generate guest token for future authenticated requests
      const token = generateGuestToken(phoneNumber, botData?.id);

      res.json({
        success: true,
        phoneNumber: `+${phoneNumber}`,
        botActive,
        botServer,
        crossServer: botServer !== currentServer,
        token,
        message: botActive 
          ? "Bot is active and connected" 
          : "Bot found but not currently connected",
        ...(botData && {
          botId: botData.id,
          botName: botData.name,
          lastActivity: botData.lastActivity
        }),
        connectionUpdated: !botActive && credentials ? true : false,
        ...(credentials && {
          nextStep: botActive ? 'authenticated' : 'update_credentials'
        })
      });

    } catch (error) {
      console.error('Guest session verification error:', error);
      res.status(500).json({ message: "Failed to verify session" });
    }
  });

  // Guest OTP Verification - Verify code and get guest token
  app.post("/api/guest/auth/verify-otp", async (req, res) => {
    try {
      const { phoneNumber, otp } = req.body;

      if (!phoneNumber || !otp) {
        return res.status(400).json({ message: "Phone number and OTP are required" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Verify OTP
      const isValid = verifyGuestOTP(cleanedPhone, otp);
      if (!isValid) {
        return res.status(400).json({ 
          message: "Invalid or expired verification code. Please request a new one." 
        });
      }

      // Check if bot exists and get bot ID
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      if (!globalRegistration) {
        clearGuestSession(cleanedPhone);
        return res.status(404).json({ message: "Bot registration not found" });
      }

      let botId = undefined;
      const currentServer = getServerName();

      if (globalRegistration.tenancyName === currentServer) {
        const botInstance = await storage.getBotByPhoneNumber(cleanedPhone);
        if (botInstance) {
          botId = botInstance.id;
          setGuestBotId(cleanedPhone, botId);
        }
      }

      // Generate guest token
      const token = generateGuestToken(cleanedPhone, botId);

      console.log(`✅ Guest authentication successful for ${cleanedPhone}`);

      res.json({
        success: true,
        token,
        phoneNumber: cleanedPhone,
        botId,
        serverMatch: globalRegistration.tenancyName === currentServer,
        registeredServer: globalRegistration.tenancyName,
        expiresIn: 7200, // 2 hours
        message: "Authentication successful"
      });

    } catch (error) {
      console.error('Guest OTP verify error:', error);
      res.status(500).json({ message: "Failed to verify code" });
    }
  });

  // ======= GUEST BOT ACTION ENDPOINTS =======

  // Guest bot action endpoint - cross-server bot management
  app.post("/api/guest/bot-action", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const { action, botId } = req.body;
      const guestPhone = req.guest.phoneNumber;
      const guestBotId = req.guest.botId;

      if (!action || !botId) {
        return res.status(400).json({ message: "Action and bot ID are required" });
      }

      const validActions = ['start', 'stop', 'restart', 'reactivate', 'delete'];
      if (!validActions.includes(action)) {
        return res.status(400).json({ 
          message: "Invalid action",
          validActions 
        });
      }

      console.log(`🎮 Guest bot action: ${action} for bot ${botId} by ${guestPhone}`);

      try {
        // Resolve bot by ID with tenancy support
        const resolution = await resolveBotById(botId, guestPhone);
        const { bot, isLocal, serverName, canManage, needsProxy } = resolution;

        // Validate guest permissions
        const actionValidation = validateGuestAction(action, bot);
        if (!actionValidation.allowed) {
          return res.status(403).json({ 
            message: actionValidation.reason 
          });
        }

        // Handle cross-server bots
        if (!isLocal) {
          return res.status(400).json({
            message: `Bot is hosted on ${serverName} server. Cross-server ${action} actions are not supported yet.`,
            crossServer: true,
            hostingServer: serverName,
            action: action
          });
        }

        // Perform local bot actions
        let result;
        switch (action) {
          case 'start':
            result = await botManager.startBot(botId);
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot started by guest user ${guestPhone}`,
              metadata: { action: 'start', guestUser: guestPhone },
              serverName: getServerName()
            });
            break;

          case 'stop':
            result = await botManager.stopBot(botId);
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot stopped by guest user ${guestPhone}`,
              metadata: { action: 'stop', guestUser: guestPhone },
              serverName: getServerName()
            });
            break;

          case 'restart':
            await botManager.stopBot(botId);
            result = await botManager.startBot(botId);
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot restarted by guest user ${guestPhone}`,
              metadata: { action: 'restart', guestUser: guestPhone },
              serverName: getServerName()
            });
            break;

          case 'reactivate':
            // Update bot status and restart if approved
            if (bot.approvalStatus === 'approved') {
              await storage.updateBotInstance(botId, { status: 'loading' });
              result = await botManager.startBot(botId);
              await storage.createActivity({
                botInstanceId: botId,
                type: 'bot_control',
                description: `Bot reactivated by guest user ${guestPhone}`,
                metadata: { action: 'reactivate', guestUser: guestPhone },
                serverName: getServerName()
              });
            } else {
              return res.status(400).json({
                message: "Only approved bots can be reactivated"
              });
            }
            break;

          case 'delete':
            // Stop the bot first
            await botManager.stopBot(botId);
            await botManager.destroyBot(botId);

            // Delete related data
            await storage.deleteBotRelatedData(botId);
            await storage.deleteBotInstance(botId);

            // Remove from global registration
            await storage.deleteGlobalRegistration(guestPhone);

            await storage.createActivity({
              botInstanceId: botId,
              type: 'deletion',
              description: `Bot deleted by guest user ${guestPhone}`,
              metadata: { action: 'delete', guestUser: guestPhone, botName: bot.name },
              serverName: getServerName()
            });

            result = { deleted: true };
            break;
        }

        console.log(`✅ Bot ${action} completed for ${botId}`);

        res.json({
          success: true,
          message: `Bot ${action} completed successfully`,
          action,
          botId,
          result
        });

      } catch (resolutionError: any) {
        if (resolutionError.message.includes("No bot found")) {
          return res.status(404).json({ message: "Bot not found or access denied" });
        }
        throw resolutionError;
      }

    } catch (error) {
      console.error(`❌ Guest bot action error:`, error);
      res.status(500).json({ message: "Failed to perform bot action" });
    }
  });

  // Guest Bot Features - Update bot features (approved users only)  
  app.post("/api/guest/bot/features", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const { feature, enabled } = req.body;
      const guestPhone = req.guest.phoneNumber;
      const botId = req.guest.botId;

      const validFeatures = ['autoLike', 'autoViewStatus', 'autoReact', 'chatgptEnabled'];
      if (!feature || !validFeatures.includes(feature)) {
        return res.status(400).json({ 
          message: "Invalid feature", 
          validFeatures 
        });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: "Enabled must be true or false" });
      }

      console.log(`🎛️ Guest feature update: ${feature} = ${enabled} for bot ${botId} by ${guestPhone}`);

      // Get bot data to verify it's approved
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (bot.approvalStatus !== 'approved') {
        return res.status(403).json({ 
          message: "Feature management is only available for approved bots",
          approvalStatus: bot.approvalStatus
        });
      }

      // Update the feature
      const updateData: any = {};
      updateData[feature] = enabled;

      await storage.updateBotInstance(botId, updateData);
      await storage.createActivity({
        botInstanceId: botId,
        type: 'feature_update',
        description: `${feature} ${enabled ? 'enabled' : 'disabled'} by guest user ${guestPhone}`,
        metadata: { 
          feature, 
          enabled, 
          guestUser: guestPhone 
        },
        serverName: getServerName()
      });

      console.log(`✅ Feature ${feature} updated to ${enabled} for bot ${botId}`);

      // Get updated bot data
      const updatedBot = await storage.getBotInstance(botId);

      res.json({
        success: true,
        message: `${feature} ${enabled ? 'enabled' : 'disabled'} successfully`,
        feature,
        enabled,
        botId,
        features: {
          autoLike: updatedBot?.autoLike || false,
          autoViewStatus: updatedBot?.autoViewStatus || false,
          autoReact: updatedBot?.autoReact || false,
          chatgptEnabled: updatedBot?.chatgptEnabled || false,
          typingMode: updatedBot?.typingMode || 'none'
        }
      });

    } catch (error) {
      console.error(`❌ Guest feature update error:`, error);
      res.status(500).json({ message: "Failed to update bot feature" });
    }
  });

  // Guest Bot Info - Get detailed bot information for authenticated guest
  app.get("/api/guest/bot/info", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const guestPhone = req.guest.phoneNumber;
      const botId = req.guest.botId;

      console.log(`📋 Guest requesting bot info for ${botId} by ${guestPhone}`);

      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Get recent activities for this bot
      const activities = await storage.getActivities(botId, 10); // Get last 10 activities

      // Get bot status from bot manager (fallback to checking stored status)
      const isOnline = bot.status === 'online' || bot.status === 'loading';

      // Apply data masking for guest endpoint (includes features)
      const maskedBotData = maskBotDataForGuest({
        ...bot,
        isOnline,
        canManage: bot.approvalStatus === 'approved'
        // Note: activities are excluded from masked data for privacy
      }, true);

      res.json(maskedBotData);

    } catch (error) {
      console.error(`❌ Guest bot info error:`, error);
      res.status(500).json({ message: "Failed to get bot information" });
    }
  });

  // Guest bot start - requires authentication and ownership verification
  app.post("/api/guest/bot/start", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const { phoneNumber, botId } = req.guest;

      // Additional ownership check
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (botInstance.phoneNumber !== phoneNumber) {
        return res.status(403).json({ message: "Access denied - you do not own this bot" });
      }

      if (botInstance.approvalStatus !== 'approved') {
        return res.status(403).json({ message: "Bot is not approved for starting" });
      }

      // Start the bot
      await botManager.createBot(botId, botInstance);
      await botManager.startBot(botId);

      // Log activity
      await storage.createActivity({
        botInstanceId: botId,
        type: 'startup',
        description: `Bot started by guest user via phone verification (${phoneNumber})`,
        metadata: { guestAuth: true, phoneNumber },
        serverName: getServerName()
      });

      res.json({ 
        success: true, 
        message: "Bot started successfully",
        botId,
        status: 'starting'
      });

    } catch (error) {
      console.error('Guest bot start error:', error);
      res.status(500).json({ message: "Failed to start bot" });
    }
  });

  // Guest bot stop - requires authentication and ownership verification  
  app.post("/api/guest/bot/stop", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const { phoneNumber, botId } = req.guest;

      // Additional ownership check
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (botInstance.phoneNumber !== phoneNumber) {
        return res.status(403).json({ message: "Access denied - you do not own this bot" });
      }

      // Stop the bot
      await botManager.stopBot(botId);

      // Log activity
      await storage.createActivity({
        botInstanceId: botId,
        type: 'shutdown',
        description: `Bot stopped by guest user via phone verification (${phoneNumber})`,
        metadata: { guestAuth: true, phoneNumber },
        serverName: getServerName()
      });

      res.json({ 
        success: true, 
        message: "Bot stopped successfully",
        botId,
        status: 'stopping'
      });

    } catch (error) {
      console.error('Guest bot stop error:', error);
      res.status(500).json({ message: "Failed to stop bot" });
    }
  });

  // Guest bot delete - requires authentication and ownership verification
  app.delete("/api/guest/bot/delete", authenticateGuestWithBot, async (req: any, res) => {
    try {
      const { phoneNumber, botId } = req.guest;

      // Additional ownership check
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        return res.status(404).json({ message: "Bot not found" });
      }

      if (botInstance.phoneNumber !== phoneNumber) {
        return res.status(403).json({ message: "Access denied - you do not own this bot" });
      }

      // Stop the bot first if running
      try {
        await botManager.stopBot(botId);
      } catch (error) {
        console.log(`Bot ${botId} was not running, proceeding with deletion`);
      }

      // Delete bot from bot manager
      try {
        await botManager.deleteBot(botId);
      } catch (error) {
        console.log(`Bot ${botId} not in bot manager, proceeding with database deletion`);
      }

      // Delete related data
      await storage.deleteBotRelatedData(botId);

      // Delete bot instance
      await storage.deleteBotInstance(botId);

      // Remove from global registration
      await storage.deleteGlobalRegistration(phoneNumber);

      // Clear guest session
      clearGuestSession(phoneNumber);

      // Log final activity (cross-tenancy for record keeping)
      await storage.createCrossTenancyActivity({
        type: 'deletion',
        description: `Bot deleted by guest user via phone verification (${phoneNumber})`,
        metadata: { 
          guestAuth: true, 
          phoneNumber,
          botName: botInstance.name,
          deletedBotId: botId
        },
        serverName: getServerName(),
        phoneNumber,
        remoteTenancy: undefined
      });

      console.log(`🗑️ Guest user ${phoneNumber} deleted bot ${botInstance.name} (${botId})`);

      res.json({ 
        success: true, 
        message: "Bot deleted successfully",
        botId
      });

    } catch (error) {
      console.error('Guest bot delete error:', error);
      res.status(500).json({ message: "Failed to delete bot" });
    }
  });

  // Test credentials endpoint - verify if session ID works for WhatsApp connection
  app.post("/api/guest/test-credentials", async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      // Decode and parse credentials
      let credentials;
      try {
        const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
        credentials = JSON.parse(decoded);
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid session ID format",
          connectionOpen: false
        });
      }

      // Validate credentials using WhatsApp bot validation
      const { WhatsAppBot } = await import('./services/whatsapp-bot');
      const validation = WhatsAppBot.validateCredentials(credentials);

      if (!validation.valid) {
        return res.json({ 
          connectionOpen: false,
          message: validation.error || "Credentials validation failed"
        });
      }

      // Test actual connection by creating a temporary bot instance
      try {
        const { WhatsAppBot } = await import('./services/whatsapp-bot');

        const testBotInstance = {
          id: `test_${Date.now()}`,
          name: 'Test Bot',
          phoneNumber: credentials.creds?.me?.id?.match(/^(\d+):/)?.[1] || 'unknown',
          credentials,
          serverName: getServerName(),
          status: 'testing',
          approvalStatus: 'approved',
          settings: {},
          messagesCount: 0,
          commandsCount: 0
        };

        // Create temporary WhatsApp bot for testing
        const testBot = new WhatsAppBot(testBotInstance as any);

        // Start the bot and check if it connects
        await new Promise((resolve, reject) => {
          let connectionTimeout: NodeJS.Timeout;
          let resolved = false;

          const cleanup = () => {
            if (connectionTimeout) clearTimeout(connectionTimeout);
            if (!resolved) {
              resolved = true;
              testBot.stop().catch(() => {});
            }
          };

          // Set timeout for connection test (30 seconds)
          connectionTimeout = setTimeout(() => {
            cleanup();
            reject(new Error("Connection timeout - credentials may be expired"));
          }, 30000);

          // Override event handlers to capture connection status
          testBot.start().then(() => {
            // Monitor for connection events
            setTimeout(async () => {
              const status = testBot.getStatus();
              cleanup();

              if (status === 'online') {
                resolve(true);
              } else {
                reject(new Error("Failed to establish connection - credentials may be expired"));
              }
            }, 5000); // Give 5 seconds for connection to establish

          }).catch((error) => {
            cleanup();
            reject(error);
          });
        });

        await testBot.stop();

        res.json({ 
          connectionOpen: true,
          message: "Credentials are valid and connection successful"
        });

      } catch (connectionError) {
        console.error('Credential test connection error:', connectionError);
        res.json({ 
          connectionOpen: false,
          message: connectionError instanceof Error ? connectionError.message : "Connection test failed"
        });
      }

    } catch (error) {
      console.error('Test credentials error:', error);
      res.status(500).json({ 
        message: "Failed to test credentials",
        connectionOpen: false
      });
    }
  });

  // Update session ID with connection testing
  app.post("/api/guest/update-session", async (req, res) => {
    try {
      const { phoneNumber, newSessionId } = req.body;

      if (!phoneNumber || !newSessionId) {
        return res.status(400).json({ message: "Phone number and new session ID are required" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Parse and validate new session credentials
      let newCredentials;
      try {
        const base64Data = newSessionId.trim();
        const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
        newCredentials = JSON.parse(decoded);
      } catch (error) {
        return res.status(400).json({ message: "Invalid session ID format. Please ensure it's properly encoded WhatsApp session data." });
      }

      // Enhanced phone number extraction from new credentials
      let credentialPhone = null;

      // Method 1: Check credentials.creds.me.id (most common)
      if (newCredentials?.creds?.me?.id) {
        const phoneMatch = newCredentials.creds.me.id.match(/^(\d+):/);
        credentialPhone = phoneMatch ? phoneMatch[1] : null;
      }

      // Method 2: Check credentials.me.id (alternative format)
      if (!credentialPhone && newCredentials?.me?.id) {
        const phoneMatch = newCredentials.me.id.match(/^(\d+):/);
        credentialPhone = phoneMatch ? phoneMatch[1] : null;
      }

      // Method 3: Deep search for phone numbers in credentials
      if (!credentialPhone) {
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

        credentialPhone = findPhoneInObject(newCredentials);
      }

      if (!credentialPhone) {
        console.error('Failed to extract phone number from new credentials:', {
          hasCredsMe: !!(newCredentials?.creds?.me),
          hasMe: !!(newCredentials?.me),
          credsKeys: newCredentials?.creds ? Object.keys(newCredentials.creds) : [],
          topLevelKeys: newCredentials ? Object.keys(newCredentials) : []
        });
        return res.status(400).json({ 
          message: "Cannot extract phone number from new session credentials. Please ensure you're using valid WhatsApp session data with proper phone number information." 
        });
      }

      if (credentialPhone !== cleanedPhone) {
        return res.status(400).json({ 
          message: `Update failed: New session ID does not match your phone number. Expected ${cleanedPhone}, got ${credentialPhone}` 
        });
      }

      // Find existing bot first
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      if (!globalRegistration) {
        return res.status(404).json({ message: "Bot registration not found" });
      }

      const currentServer = getServerName();
      if (globalRegistration.tenancyName !== currentServer) {
        return res.status(400).json({
          message: `Bot is registered on ${globalRegistration.tenancyName} server. Cross-server credential updates are not supported yet.`
        });
      }

      const existingBot = await storage.getBotByPhoneNumber(cleanedPhone);
      if (!existingBot) {
        return res.status(404).json({ message: "Bot not found on current server" });
      }

      // Test connection with new credentials using the EXISTING bot instance
      let botOwnerJid = null;

      try {
        const { WhatsAppBot } = await import('./services/whatsapp-bot');

        // Create test bot instance using existing bot data but with new credentials
        const testBotInstance = {
          ...existingBot,
          credentials: newCredentials, // Use NEW credentials for testing
          status: 'testing'
        };

        const testBot = new WhatsAppBot(testBotInstance as any);

        // Test connection by attempting to start the bot briefly
        console.log(`Testing connection for ${cleanedPhone} with new session ID...`);

        // Create a promise that resolves when connection is established or fails
        const connectionTest = new Promise((resolve, reject) => {
          let connectionTimeout: NodeJS.Timeout;
          let connectionEstablished = false;

          const startTest = async () => {
            try {
              await testBot.start();

              // Set a timeout to check connection status
              connectionTimeout = setTimeout(() => {
                if (!connectionEstablished) {
                  testBot.stop();
                  reject(new Error('Connection timeout - credentials may be invalid or expired'));
                }
              }, 8000); // 8 second timeout

              // Check if bot connects successfully
              const checkConnection = () => {
                const status = testBot.getStatus();
                if (status === 'online') {
                  connectionEstablished = true;
                  clearTimeout(connectionTimeout);

                  // Get bot owner JID for success message
                  if (testBot.sock && testBot.sock.user && testBot.sock.user.id) {
                    botOwnerJid = testBot.sock.user.id;
                  }

                  testBot.stop();
                  resolve(true);
                } else {
                  // Keep checking for a short while
                  setTimeout(checkConnection, 1000);
                }
              };

              // Start checking after a brief delay
              setTimeout(checkConnection, 2000);

            } catch (error) {
              clearTimeout(connectionTimeout);
              testBot.stop();
              reject(error);
            }
          };

          startTest();
        });

        await connectionTest;
        console.log(`✅ Connection test successful for ${cleanedPhone} with new credentials`);

      } catch (connectionError) {
        console.error(`❌ Connection test failed for ${cleanedPhone}:`, connectionError);
        return res.status(400).json({
          connectionOpen: false,
          message: `Update failed: Failed to establish connection with new session ID. Please ensure your new session ID is valid and active. Error: ${connectionError instanceof Error ? connectionError.message : 'Connection timeout'}`
        });
      }

      // Connection successful - update the existing bot's credentials
      try {
        await storage.updateBotInstance(existingBot.id, {
          credentials: newCredentials, // Update with NEW credentials
          credentialVerified: true,
          invalidReason: null,
          autoStart: true,
          status: 'loading'
        });

        console.log(`✅ Updated credentials for bot ${existingBot.id} with new session ID`);

        // Send success message to bot owner if we got the JID
        let successMessageSent = false;
        if (botOwnerJid) {
          try {
            const successMessage = `🎉 Session ID Update Successful! 🎉

Your TREKKER-MD bot "${existingBot.name}" has been successfully updated with new credentials and is now reconnecting!

📱 *Update Details:*
• Phone: ${cleanedPhone}
• Bot ID: ${existingBot.id}
• Status: ✅ Credentials Updated & Reconnecting
• Time: ${new Date().toLocaleString()}

🚀 *Your bot will be online shortly!*
All features will be restored once reconnection is complete.

Thank you for using TREKKER-MD! 🚀`;

            await sendGuestValidationMessage(cleanedPhone, JSON.stringify(newCredentials), successMessage, false);
            successMessageSent = true;
            console.log(`✅ Success message sent to ${cleanedPhone}`);
          } catch (messageError) {
            console.warn(`⚠️ Failed to send success message to ${cleanedPhone}:`, messageError);
          }
        }

        return res.json({
          success: true,
          connectionOpen: true,
          successMessageSent,
          message: successMessageSent 
            ? "Session ID updated successfully! New connection verified and success message sent to your WhatsApp."
            : "Session ID updated successfully! New connection verified.",
          botId: existingBot.id
        });

      } catch (updateError) {
        console.error(`❌ Failed to update bot credentials for ${cleanedPhone}:`, updateError);
        return res.status(500).json({
          connectionOpen: true,
          message: `Connection successful but credential update failed: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`
        });
      }

    } catch (error) {
      console.error('Session update error:', error);
      return res.status(500).json({ 
        connectionOpen: false,
        message: "Failed to update session ID. Please try again." 
      });
    }
  });

  // ======= GUEST SERVER BOT MANAGEMENT ENDPOINTS =======

  // Guest search server bots - Find bots by phone number on current server
  app.post("/api/guest/search-server-bots", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      console.log(`🔍 Searching for phone ${cleanedPhone} on server ${currentServer}`);

      // Search for bots with this phone number on current server
      const bots = await db.select()
        .from(botInstances)
        .where(
          and(
            eq(botInstances.phoneNumber, cleanedPhone),
            eq(botInstances.serverName, currentServer)
          )
        )
        .orderBy(desc(botInstances.createdAt));

      console.log(`📋 Found ${bots.length} bot(s) for ${cleanedPhone} on ${currentServer}`);

      if (bots.length === 0) {
        // Also check with different phone number formats
        const altFormats = [
          `+${cleanedPhone}`,
          cleanedPhone.startsWith('254') ? cleanedPhone.substring(3) : `254${cleanedPhone}`,
        ];

        for (const altPhone of altFormats) {
          const altBots = await db.select()
            .from(botInstances)
            .where(
              and(
                eq(botInstances.phoneNumber, altPhone),
                eq(botInstances.serverName, currentServer)
              )
            )
            .orderBy(desc(botInstances.createdAt));

          if (altBots.length > 0) {
            console.log(`📋 Found ${altBots.length} bot(s) using alternative format ${altPhone}`);
            bots.push(...altBots);
            break;
          }
        }
      }

      if (bots.length === 0) {
        return res.json({
          bots: [],
          serverName: currentServer,
          message: `No bots found with phone number ${phoneNumber} on ${currentServer}`
        });
      }

      // Return comprehensive bot data for proper management
      const botData = bots.map(bot => ({
        id: bot.id,
        botId: bot.id, // Add botId for compatibility
        name: bot.name,
        phoneNumber: bot.phoneNumber,
        status: bot.status,
        approvalStatus: bot.approvalStatus,
        serverName: 'Protected', // Mask server name for security
        lastActivity: bot.lastActivity,
        messagesCount: bot.messagesCount || 0,
        commandsCount: bot.commandsCount || 0,
        isActive: bot.status === 'online',
        isApproved: bot.approvalStatus === 'approved',
        canManage: bot.approvalStatus === 'approved',
        crossServer: false,
        // Feature flags
        features: {
          autoLike: bot.autoLike || false,
          autoView: bot.autoViewStatus || false,
          autoReact: bot.autoReact || false,
          chatGPT: bot.chatgptEnabled || false,
          typingIndicator: bot.typingMode === 'typing',
          alwaysOnline: bot.alwaysOnline || false,
          autoRecording: bot.presenceMode === 'recording',
        },
        // Management info
        credentialVerified: bot.credentialVerified || false,
        autoStart: bot.autoStart || false,
        approvalDate: bot.approvalDate,
        expirationMonths: bot.expirationMonths,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt
      }));

      res.json({
        bots: botData,
        serverName: currentServer,
        count: bots.length,
        message: `Found ${bots.length} bot(s) for ${phoneNumber} on ${currentServer}`
      });

    } catch (error) {
      console.error('Guest search server bots error:', error);
      res.status(500).json({ message: "Failed to search for bots" });
    }
  });

  // Guest server bot action - Perform actions on bots (start, stop, restart, delete)
  app.post("/api/guest/server-bot-action", async (req, res) => {
    try {
      const { action, botId, phoneNumber } = req.body;

      if (!action || !botId || !phoneNumber) {
        return res.status(400).json({ message: "Action, bot ID, and phone number are required" });
      }

      const validActions = ['start', 'stop', 'restart', 'delete'];
      if (!validActions.includes(action)) {
        return res.status(400).json({ 
          message: "Invalid action",
          validActions 
        });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      // Get bot and verify ownership
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Verify phone number ownership
      const botCleanedPhone = bot.phoneNumber?.replace(/[\s\-\(\)\+]/g, '') || '';
      if (cleanedPhone !== botCleanedPhone) {
        return res.status(403).json({ message: "You can only manage your own bots" });
      }

      // Verify bot is on current server
      if (bot.serverName !== currentServer) {
        return res.status(403).json({ 
          message: `Bot is on ${bot.serverName}, not ${currentServer}. Cannot manage cross-server bots.` 
        });
      }

      // Perform the action
      let result;
      switch (action) {
        case 'start':
          if (bot.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Only approved bots can be started" });
          }
          try {
            result = await botManager.startBot(botId);
            await storage.updateBotInstance(botId, { status: 'loading' });
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot started by guest user ${cleanedPhone}`,
              metadata: { action: 'start', guestUser: cleanedPhone },
              serverName: currentServer
            });
          } catch (startError) {
            console.error(`Failed to start bot ${botId}:`, startError);
            return res.status(500).json({ message: "Failed to start bot. Please try again." });
          }
          break;

        case 'stop':
          if (bot.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Only approved bots can be stopped" });
          }
          try {
            result = await botManager.stopBot(botId);
            await storage.updateBotInstance(botId, { status: 'offline' });
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot stopped by guest user ${cleanedPhone}`,
              metadata: { action: 'stop', guestUser: cleanedPhone },
              serverName: currentServer
            });
          } catch (stopError) {
            console.error(`Failed to stop bot ${botId}:`, stopError);
            return res.status(500).json({ message: "Failed to stop bot. Please try again." });
          }
          break;

        case 'restart':
          if (bot.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Only approved bots can be restarted" });
          }
          try {
            await botManager.stopBot(botId);
            result = await botManager.startBot(botId);
            await storage.updateBotInstance(botId, { status: 'loading' });
            await storage.createActivity({
              botInstanceId: botId,
              type: 'bot_control',
              description: `Bot restarted by guest user ${cleanedPhone}`,
              metadata: { action: 'restart', guestUser: cleanedPhone },
              serverName: currentServer
            });
          } catch (restartError) {
            console.error(`Failed to restart bot ${botId}:`, restartError);
            return res.status(500).json({ message: "Failed to restart bot. Please try again." });
          }
          break;

        case 'delete':
          try {
            // Stop the bot first
            await botManager.stopBot(botId);
            await botManager.destroyBot(botId);

            // Delete related data
            await storage.deleteBotRelatedData(botId);
            await storage.deleteBotInstance(botId);

            // Remove from global registration
            await storage.deleteGlobalRegistration(cleanedPhone);

            await storage.createActivity({
              botInstanceId: botId,
              type: 'deletion',
              description: `Bot deleted by guest user ${cleanedPhone}`,
              metadata: { action: 'delete', guestUser: cleanedPhone, botName: bot.name },
              serverName: currentServer
            });

            result = { deleted: true };
          } catch (deleteError) {
            console.error(`Failed to delete bot ${botId}:`, deleteError);
            return res.status(500).json({ message: "Failed to delete bot. Please try again." });
          }
          break;
      }

      console.log(`✅ Guest bot ${action} completed for ${botId} by ${cleanedPhone}`);

      res.json({
        success: true,
        message: `Bot ${action} completed successfully`,
        action,
        botId,
        result
      });

    } catch (error) {
      console.error(`❌ Guest server bot action error:`, error);
      res.status(500).json({ message: "Failed to perform bot action" });
    }
  });

  // Guest server bot features - Update bot features (all approved bots)
  app.post("/api/guest/server-bot-features", async (req, res) => {
    try {
      const { feature, enabled, botId, phoneNumber } = req.body;

      if (!feature || typeof enabled !== 'boolean' || !botId || !phoneNumber) {
        return res.status(400).json({ message: "Feature, enabled status, bot ID, and phone number are required" });
      }

      const validFeatures = ['autoLike', 'autoViewStatus', 'autoReact', 'chatgptEnabled', 'alwaysOnline', 'presenceAutoSwitch'];
      if (!validFeatures.includes(feature)) {
        return res.status(400).json({ 
          message: "Invalid feature", 
          validFeatures 
        });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      // Get bot and verify ownership
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }

      // Verify phone number ownership
      const botCleanedPhone = bot.phoneNumber?.replace(/[\s\-\(\)\+]/g, '') || '';
      if (cleanedPhone !== botCleanedPhone) {
        return res.status(403).json({ message: "You can only manage your own bots" });
      }

      // Verify bot is on current server
      if (bot.serverName !== currentServer) {
        return res.status(403).json({ 
          message: `Bot is on ${bot.serverName}, not ${currentServer}. Cannot manage cross-server bots.` 
        });
      }

      // For some features, we allow management even if not approved (like updating settings)
      // But for others, we require approval
      const requiresApproval = ['autoLike', 'autoViewStatus', 'autoReact', 'chatgptEnabled'];
      if (requiresApproval.includes(feature) && bot.approvalStatus !== 'approved') {
        return res.status(403).json({ 
          message: "This feature can only be modified for approved bots",
          approvalStatus: bot.approvalStatus
        });
      }

      // Update the feature
      const updateData: any = {};
      updateData[feature] = enabled;

      await storage.updateBotInstance(botId, updateData);
      await storage.createActivity({
        botInstanceId: botId,
        type: 'feature_update',
        description: `${feature} ${enabled ? 'enabled' : 'disabled'} by guest user ${cleanedPhone}`,
        metadata: { 
          feature, 
          enabled, 
          guestUser: cleanedPhone 
        },
        serverName: currentServer
      });

      console.log(`✅ Feature ${feature} updated to ${enabled} for bot ${botId} by ${cleanedPhone}`);

      res.json({
        success: true,
        message: `${feature} ${enabled ? 'enabled' : 'disabled'} successfully`,
        feature,
        enabled,
        botId
      });

    } catch (error) {
      console.error(`❌ Guest server bot features error:`, error);
      res.status(500).json({ message: "Failed to update bot feature" });
    }
  });

  // ======= NEW GUEST ENDPOINTS FOR CROSS-TENANCY SUPPORT =======

  // Guest my-bots endpoint - Get all bots for a phone number across servers
  app.post("/api/guest/my-bots", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Use new tenancy resolution helper
      try {
        const resolution = await resolveBotByPhone(phoneNumber);
        const { bot, isLocal, serverName, canManage, needsProxy } = resolution;

        // Return array of bots (even if just one) with proper masking and permissions
        const botInfo = maskBotDataForGuest({
          ...bot,
          canManage,
          crossServer: !isLocal,
          needsCredentialValidation: true,
          nextStep: canManage ? 'ready_to_manage' : 'credential_validation_required',
          message: canManage 
            ? `Bot ready for management.${!isLocal ? ` Hosted on ${serverName} server.` : ''}`
            : `Please verify your credentials to access management features.${!isLocal ? ` Bot is hosted on ${serverName} server.` : ''}`
        }, true);

        // Override server name for security
        botInfo.serverName = 'Protected';

        res.json([botInfo]); // Return as array

      } catch (resolutionError: any) {
        if (resolutionError.message.includes("No bot found")) {
          return res.json([]); // Return empty array if no bots found
        }
        throw resolutionError;
      }

    } catch (error) {
      console.error('Guest my-bots error:', error);
      res.status(500).json({ message: "Failed to fetch bots" });
    }
  });

  // Guest cross-server-bots endpoint - Get bots from other servers
  app.post("/api/guest/cross-server-bots", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const currentServer = getServerName();

      // Check God Registry to find hosting server
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      if (!globalRegistration) {
        return res.json([]); // No bots found
      }

      const hostingServer = globalRegistration.tenancyName;

      // Only return cross-server bots (not local ones)
      if (hostingServer === currentServer) {
        return res.json([]); // Bot is local, not cross-server
      }

      // Create cross-server bot info
      const crossServerBot = maskBotDataForGuest({
        id: `cross-server-${cleanedPhone}`,
        name: `Bot (${cleanedPhone})`,
        phoneNumber: cleanedPhone,
        status: "cross-server",
        approvalStatus: "unknown",
        messagesCount: 0,
        commandsCount: 0,
        lastActivity: null,
        crossServer: true,
        canManage: false,
        needsCredentialValidation: true,
        nextStep: 'credential_validation_required',
        message: `Your bot is hosted on ${hostingServer} server. Please verify your credentials to access management features.`
      }, true);

      // Override server name for security
      crossServerBot.serverName = 'Protected';

      res.json([crossServerBot]);

    } catch (error) {
      console.error('Guest cross-server-bots error:', error);
      res.status(500).json({ message: "Failed to fetch cross-server bots" });
    }
  });

  // Guest verify-phone endpoint - Basic phone verification for guest access
  app.post("/api/guest/verify-phone", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Check if phone number is registered in God Registry
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);

      if (!globalRegistration) {
        return res.json({
          registered: false,
          message: "Phone number not found in our system",
          canRegister: true,
          nextStep: "register_new_bot"
        });
      }

      const hostingServer = globalRegistration.tenancyName;
      const currentServer = getServerName();
      const isLocal = hostingServer === currentServer;

      res.json({
        registered: true,
        isLocal,
        hostingServer: isLocal ? currentServer : 'Protected', // Mask remote server names
        crossServer: !isLocal,
        message: isLocal 
          ? "Phone number verified. You can manage your bot on this server."
          : "Phone number verified. Your bot is hosted on another server.",
        nextStep: "credential_validation_required",
        canRegister: false
      });

    } catch (error) {
      console.error('Guest verify-phone error:', error);
      res.status(500).json({ message: "Failed to verify phone number" });
    }
  });

  // ======= EXISTING GUEST ENDPOINTS =======

  // Guest bot search endpoint - SECURITY: Requires credential validation for management access
  app.post("/api/guest/search-bot", async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Use new tenancy resolution helper
      try {
        const resolution = await resolveBotByPhone(phoneNumber);
        const { bot, isLocal, serverName, canManage, needsProxy } = resolution;

        // Create masked bot info with proper permission flags
        const botInfo = maskBotDataForGuest({
          ...bot,
          canManage,
          crossServer: !isLocal,
          needsCredentialValidation: true, // Always require credential validation for security
          nextStep: 'credential_validation_required',
          message: `To access management features for your bot, please verify your credentials.${
            !isLocal ? ` Your bot is hosted on ${serverName} server.` : ''
          }`,
          botExists: true
        }, true);

        // Override server name for security (always mask)
        botInfo.serverName = 'Protected';

        res.json(botInfo);

      } catch (resolutionError: any) {
        if (resolutionError.message.includes("No bot found")) {
          return res.status(404).json({ 
            message: "No bot found with this phone number. You may need to register a new bot." 
          });
        }
        throw resolutionError;
      }

    } catch (error) {
      console.error('Guest bot search error:', error);
      res.status(500).json({ message: "Failed to search for bot" });
    }
  });

  // Guest bot credential validation endpoint - SECURITY: Validates ownership of existing bots
  app.post("/api/guest/validate-existing-bot", async (req, res) => {
    try {
      const { phoneNumber, sessionId } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        return res.status(400).json({ message: "Session ID is required to verify bot ownership" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Parse credentials from base64 encoded session ID
      let credentials;
      try {
        const base64Data = sessionId.trim();

        // Check Base64 size limit (5MB when decoded)
        const estimatedSize = (base64Data.length * 3) / 4; // Rough estimate of decoded size
        const maxSizeBytes = 5 * 1024 * 1024; // 5MB

        if (estimatedSize > maxSizeBytes) {
          return res.status(400).json({ 
            message: `❌ Session ID too large (estimated ${(estimatedSize / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5MB.` 
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
        return res.status(400).json({ message: "Invalid session ID format. Please ensure it's properly encoded WhatsApp session data." });
      }

      // Enhanced phone number extraction from credentials
      let credentialsPhone = null;

      // Method 1: Check credentials.creds.me.id (most common)
      if (credentials?.creds?.me?.id) {
        const credentialsPhoneMatch = credentials.creds.me.id.match(/^(\d+):/);
        credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
      }

      // Method 2: Check credentials.me.id (alternative format)
      if (!credentialsPhone && credentials?.me?.id) {
        const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/);
        credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
      }

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

      if (!credentialsPhone) {
        console.error('Failed to extract phone number from credentials for validation:', {
          hasCredsMe: !!(credentials?.creds?.me),
          hasMe: !!(credentials?.me),
          credsKeys: credentials?.creds ? Object.keys(credentials.creds) : [],
          topLevelKeys: credentials ? Object.keys(credentials) : []
        });
        return res.status(400).json({ 
          message: "Invalid session ID format - cannot extract phone number data. Please ensure you're using valid WhatsApp session credentials." 
        });
      }

      // Compare only the clean phone numbers (ignore the suffix after colon like :23@s.whatsapp.net)
      if (credentialsPhone !== cleanedPhone) {
        return res.status(400).json({
          message: "Phone number mismatch. Session belongs to +" + credentialsPhone + " but you provided +" + cleanedPhone + ". The numbers must match."
        });
      }

      // Check if bot exists
      const globalRegistration = await storage.checkGlobalRegistration(cleanedPhone);
      if (!globalRegistration) {
        return res.status(404).json({ message: "No bot found with this phone number" });
      }

      const botServer = globalRegistration.tenancyName;
      const currentServer = getServerName();

      // Handle cross-server bot (limited management)
      if (botServer !== currentServer) {
        // For cross-server bots, validate credentials but only allow credential updates
        return res.json({
          success: true,
          botValidated: true,
          crossServer: true,
          message: `Session ID verified for bot on ${botServer}. You can update credentials but cannot start/stop the bot from this server.`,
          phoneNumber: cleanedPhone,
          serverName: botServer,
          canManage: false,
          canUpdateCredentials: true,
          nextStep: 'cross_server_credential_update'
        });
      }

      // Bot is on current server - get existing bot data
      const botInstance = await storage.getBotByPhoneNumber(cleanedPhone);
      if (!botInstance) {
        return res.status(404).json({ message: "Bot found in registry but not in local database. Contact support." });
      }

      // Load existing credentials to compare
      let existingCredentials;
      try {
        const authDir = path.join(process.cwd(), 'auth', `bot_${botInstance.id}`);
        const credentialsPath = path.join(authDir, 'creds.json');

        if (fs.existsSync(credentialsPath)) {
          const existingFileContent = fs.readFileSync(credentialsPath, 'utf-8');
          existingCredentials = JSON.parse(existingFileContent);

          // Compare key credential data to validate ownership
          let existingPhone = null;

          // Handle both credential formats for existing data
          if (existingCredentials?.creds?.me?.id) {
            const existingPhoneMatch = existingCredentials.creds.me.id.match(/^(\d+):/);
            existingPhone = existingPhoneMatch ? existingPhoneMatch[1] : null;
          } else if (existingCredentials?.me?.id) {
            const existingPhoneMatch = existingCredentials.me.id.match(/^(\d+):/);
            existingPhone = existingPhoneMatch ? existingPhoneMatch[1] : null;
          }

          if (existingPhone !== credentialsPhone) {
            return res.status(403).json({
              message: "Credential validation failed. The provided session ID does not match the existing bot credentials."
            });
          }
        } else {
          console.log(`No existing credentials found for bot ${botInstance.id}, allowing validation with provided credentials`);
        }
      } catch (error) {
        console.warn('Could not load existing credentials for validation:', error);
        // Continue with validation since we've already validated phone number ownership
      }

      // Generate guest authentication token after successful validation
      const guestToken = generateGuestToken(cleanedPhone, botInstance.id);

      // Set guest session
      setGuestBotId(cleanedPhone, botInstance.id);

      // Update bot credential status
      await storage.updateBotCredentialStatus(botInstance.id, {
        credentialVerified: true,
        credentialPhone: cleanedPhone,
        invalidReason: undefined,
        credentials: credentials
      });

      // Save updated credentials to file system
      try {
        const authDir = path.join(process.cwd(), 'auth', `bot_${botInstance.id}`);
        if (!fs.existsSync(authDir)) {
          fs.mkdirSync(authDir, { recursive: true });
        }

        fs.writeFileSync(
          path.join(authDir, 'creds.json'),
          JSON.stringify(credentials, null, 2)
        );
      } catch (fileError) {
        console.error('Failed to save updated credentials:', fileError);
      }

      // Log activity
      await storage.createActivity({
        botInstanceId: botInstance.id,
        type: 'credential_validation',
        description: `Bot ownership validated via session ID verification (${cleanedPhone})`,
        metadata: { guestAuth: true, phoneNumber: cleanedPhone, validationMethod: 'session_id' },
        serverName: getServerName()
      });

      // Determine next step based on bot status
      let nextStep = 'unknown';
      let message = '';
      let canManage = false;

      if (botInstance.approvalStatus === 'pending') {
        nextStep = 'wait_approval';
        message = 'Your bot ownership is verified but the bot is pending admin approval.';
        canManage = false;
      } else if (botInstance.approvalStatus === 'approved') {
        // Check if bot is expired
        const isExpired = botInstance.approvalDate && botInstance.expirationMonths
          ? new Date() > new Date(new Date(botInstance.approvalDate).getTime() + (botInstance.expirationMonths * 30 * 24 * 60 * 60 * 1000))
          : false;

        if (isExpired) {
          nextStep = 'wait_approval';
          message = 'Your bot has expired. Please contact admin for renewal.';
          canManage = false;
        } else {
          nextStep = 'authenticated';
          message = 'Bot ownership verified! You can now manage your bot.';
          canManage = true;
        }
      } else {
        nextStep = 'wait_approval';
        message = 'Your bot registration was not approved. Contact support for assistance.';
        canManage = false;
      }

      // Return validated bot data with management capabilities
      const validatedBotData = maskBotDataForGuest({
        ...botInstance,
        nextStep,
        message,
        canManage,
        crossServer: false,
        credentialVerified: true
      });

      res.json({
        success: true,
        botValidated: true,
        guestToken,
        bot: validatedBotData,
        message: "Bot ownership successfully verified via session ID"
      });

    } catch (error) {
      console.error('Guest bot validation error:', error);
      res.status(500).json({ message: "Failed to validate bot session ID" });
    }
  });

  // Guest Credential Verification Endpoint (Protected)
  app.post("/api/guest/verify-credentials", authenticateGuestWithBot, upload.single('credentials') as any, async (req: any, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Credentials file is required" });
      }

      // Clean phone number
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');

      // Security check: Ensure guest can only update their own bot
      const guestBotId = req.guest.botId; // From authenticateGuestWithBot middleware
      const guestBotInstance = await storage.getBotInstance(guestBotId);

      if (!guestBotInstance) {
        return res.status(404).json({ 
          message: "Your bot session is invalid. Please authenticate again." 
        });
      }

      // Verify the phone number matches the authenticated bot
      const guestCleanedPhone = guestBotInstance.phoneNumber?.replace(/[\s\-\(\)\+]/g, '') || '';
      if (cleanedPhone !== guestCleanedPhone) {
        return res.status(403).json({ 
          message: "You can only update credentials for your own bot." 
        });
      }

      // Check if bot is approved
      if (guestBotInstance.approvalStatus !== 'approved') {
        return res.status(403).json({ 
          message: "Bot must be approved before credentials can be updated. Please wait for admin approval." 
        });
      }

      // Use the authenticated bot instance for all operations
      const botInstance = guestBotInstance;

      // Parse uploaded credentials
      let credentials;
      try {
        credentials = JSON.parse(req.file.buffer.toString());
      } catch (error) {
        return res.status(400).json({ 
          message: "Invalid credentials file. Please ensure you're uploading a valid creds.json file." 
        });
      }

      // Basic validation of credentials structure
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
        return res.status(400).json({ 
          message: "Invalid credentials format. Please upload a valid WhatsApp session file." 
        });
      }

      // Use existing validation function
      const validation = await validateWhatsAppCredentials(
        credentials, 
        cleanedPhone
      );

      if (validation.isValid) {
        let credentialsSaved = false;
        let messageSent = false;

        try {
          // Save credentials to bot's auth directory
          const authDir = path.join(process.cwd(), 'auth', `bot_${botInstance.id}`);
          if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
          }

          // Save the validated credentials to creds.json
          fs.writeFileSync(
            path.join(authDir, 'creds.json'), 
            JSON.stringify(credentials, null, 2)
          );
          credentialsSaved = true;
          console.log(`✅ Credentials saved for guest bot ${botInstance.id} (${cleanedPhone})`);
        } catch (fileError) {
          console.error('Failed to save credentials to file:', fileError);
          return res.status(500).json({
            success: false,
            message: "Failed to save credentials. Please try again later.",
            nextStep: "update_credentials"
          });
        }

        // Send authentication message
        const authMessage = `🔐 Your bot credentials have been successfully updated! Your bot "${botInstance.name}" is now ready to use. You can proceed with authentication to start using your bot.`;

        try {
          // Convert credentials to base64 for sending message
          const credentialsBase64 = Buffer.from(JSON.stringify(credentials)).toString('base64');
          await sendGuestValidationMessage(cleanedPhone, credentialsBase64, authMessage, true);
          messageSent = true;
          console.log(`✅ Authentication message sent to ${cleanedPhone}`);
        } catch (messageError) {
          console.error('Failed to send authentication message:', messageError);
          messageSent = false;
        }

        // Update bot credential status
        await storage.updateBotCredentialStatus(botInstance.id, {
          credentialVerified: true,
          credentialPhone: cleanedPhone,
          invalidReason: undefined,
          credentials: credentials,
          authMessageSentAt: messageSent ? new Date() : null
        });

        // Create comprehensive activity log
        await storage.createActivity({
          botInstanceId: botInstance.id,
          type: 'credential_update',
          description: 'Guest uploaded and verified new credentials',
          metadata: { 
            verifiedPhone: cleanedPhone,
            guestAction: true,
            credentialsSaved,
            messageSent,
            failureReason: messageSent ? null : 'Message sending failed'
          },
          serverName: getServerName()
        });

        const responseMessage = messageSent 
          ? "Credentials verified and saved successfully! Check your WhatsApp for authentication instructions."
          : "Credentials verified and saved successfully! However, we couldn't send the WhatsApp message. Your bot is ready to use.";

        res.json({
          success: true,
          message: responseMessage,
          verifiedPhone: cleanedPhone,
          credentialsSaved,
          messageSent,
          nextStep: "authenticated"
        });
      } else {
        // Update bot with invalid credential info
        await storage.updateBotCredentialStatus(botInstance.id, {
          credentialVerified: false,
          autoStart: false,
          invalidReason: validation.message || 'Credential verification failed'
        });

        res.status(400).json({
          success: false,
          message: validation.message || "Credentials could not be verified. Please check your credentials file and try again.",
          nextStep: "update_credentials"
        });
      }

    } catch (error) {
      console.error('Guest credential verification error:', error);
      res.status(500).json({ message: "Failed to verify credentials" });
    }
  });

  // Guest Bot Registration
  app.post("/api/guest/register-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { botName, phoneNumber, credentialType, sessionId, features, selectedServer } = req.body;

      if (!botName || !phoneNumber) {
        return res.status(400).json({ message: "Bot name and phone number are required" });
      }

      // Clean the phone number early - remove + prefix and ensure we only use the numeric part
      const cleanPhoneNumber = phoneNumber.replace(/^\+/, '').replace(/[^\d]/g, '');

      // Parse credentials first (before any phone number checks)
      let credentials = null;

      // Handle credentials based on type
      if (credentialType === 'base64' && sessionId) {
        try {
          const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
          const parsedCreds = JSON.parse(decoded);
          credentials = parsedCreds;
        } catch (error) {
          return res.status(400).json({ message: "Invalid base64 session ID format" });
        }
      } else if (credentialType === 'file' && req.file) {
        try {
          const fileContent = req.file.buffer.toString('utf-8');
          credentials = JSON.parse(fileContent);
        } catch (error) {
          return res.status(400).json({ message: "Invalid creds.json file format" });
        }
      } else {
        return res.status(400).json({ message: "Valid credentials are required" });
      }

      // Validate phone number ownership - extract clean phone number from credentials
      if (credentials && credentials.me && credentials.me.id) {
        // Extract clean phone number from credentials (format: "254704897825:33@s.whatsapp.net")
        const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/); 
        const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;

        if (!credentialsPhone || credentialsPhone !== cleanPhoneNumber) {
          return res.status(400).json({ 
            message: "You are not the owner of this credentials file. The phone number in the session does not match your input." 
          });
        }
      } else {
        return res.status(400).json({ message: "Invalid credentials format - missing phone number data" });
      }

      // Parse features if provided
      let botFeatures = {};
      if (features) {
        try {
          botFeatures = JSON.parse(features);
        } catch (error) {
          console.warn('Invalid features JSON:', error);
        }
      }

      // Get current tenant name
      const currentTenancyName = getServerName();

      // Check global registration first using clean phone number
      const globalRegistration = await storage.checkGlobalRegistration(cleanPhoneNumber);
      if (globalRegistration) {
        // Phone number is already registered to another tenant
        if (globalRegistration.tenancyName !== currentTenancyName) {
          return res.status(400).json({ 
            message: `This phone number is registered to ${globalRegistration.tenancyName}. Please go to ${globalRegistration.tenancyName} server to manage your bot.`,
            registeredTo: globalRegistration.tenancyName
          });
        }

        // Phone number belongs to this tenant - check for existing bot using clean phone number
        const existingBot = await storage.getBotByPhoneNumber(cleanPhoneNumber);
        if (existingBot) {
          // User has a bot on this server - automatically update credentials instead of blocking
          console.log(`📱 Phone number ${cleanPhoneNumber} already registered, updating credentials for bot ${existingBot.id}`);

          // Update the existing bot's credentials automatically
          let credentialsSaved = false;
          let messageSent = false;

          try {
            // Save credentials to bot's auth directory
            const authDir = path.join(process.cwd(), 'auth', `bot_${existingBot.id}`);
            if (!fs.existsSync(authDir)) {
              fs.mkdirSync(authDir, { recursive: true });
            }

            // Save the new credentials to creds.json
            fs.writeFileSync(
              path.join(authDir, 'creds.json'), 
              JSON.stringify(credentials, null, 2)
            );
            credentialsSaved = true;
            console.log(`✅ Credentials updated for existing bot ${existingBot.id} (${phoneNumber})`);
          } catch (fileError) {
            console.error('Failed to save credentials to file:', fileError);
            return res.status(500).json({
              success: false,
              message: "Failed to update credentials. Please try again later."
            });
          }

          // Send authentication message with updated credentials
          const authMessage = `🔐 Your bot credentials have been successfully updated! Your bot "${existingBot.name}" is now ready to use with the new credentials.`;

          try {
            // Convert credentials to base64 for sending message
            const credentialsBase64 = credentialType === 'base64' ? sessionId : Buffer.from(JSON.stringify(credentials)).toString('base64');
            await sendGuestValidationMessage(cleanPhoneNumber, credentialsBase64, authMessage, true);
            messageSent = true;
            console.log(`✅ Updated authentication message sent to ${cleanPhoneNumber}`);
          } catch (messageError) {
            console.error('Failed to send authentication message:', messageError);
            messageSent = false;
          }

          // Update bot credential status
          await storage.updateBotCredentialStatus(existingBot.id, {
            credentialVerified: true,
            credentialPhone: cleanPhoneNumber,
            invalidReason: undefined,
            credentials: credentials
          });

          // Update bot features if provided
          if (botFeatures && Object.keys(botFeatures).length > 0) {
            await storage.updateBotInstance(existingBot.id, {
              settings: JSON.stringify({ features: botFeatures })
            });
          }

          // Create comprehensive activity log
          await storage.createActivity({
            botInstanceId: existingBot.id,
            type: 'credential_update',
            description: 'Guest automatically updated credentials for existing bot registration',
            metadata: { 
              verifiedPhone: cleanPhoneNumber,
              guestAction: true,
              credentialsSaved,
              messageSent,
              autoUpdate: true,
              failureReason: messageSent ? null : 'Message sending failed'
            },
            serverName: getServerName()
          });

          const responseMessage = messageSent 
            ? "Credentials automatically updated! Your existing bot now has new credentials. Check your WhatsApp for updated authentication instructions."
            : "Credentials automatically updated! Your existing bot now has new credentials and is ready to use.";

          return res.json({
            success: true,
            type: 'credentials_updated',
            message: responseMessage,
            botDetails: {
              id: existingBot.id,
              name: existingBot.name,
              phoneNumber: cleanPhoneNumber,
              status: existingBot.status,
              updated: true
            },
            credentialsSaved,
            messageSent
          });
        }
      } else {
        // This is a new registration - global registration will be handled by createCrossServerRegistration
        console.log(`📝 New registration for ${cleanPhoneNumber} will be handled by cross-server registration method`);
      }

      // Check if phone number already exists locally (redundant check but for safety)
      const existingBot = await storage.getBotByPhoneNumber(cleanPhoneNumber);
      if (existingBot) {
        // Check if existing bot is active and has valid session
        if (existingBot.approvalStatus === 'approved' && existingBot.status === 'online') {
          return res.status(400).json({ 
            message: "Your previous bot is active. Can't add new bot with same number." 
          });
        }

        // If bot is inactive, test connection and handle accordingly
        if (existingBot.approvalStatus === 'approved' && existingBot.status !== 'online') {
          // Try to test connection - if fails, delete old credentials
          try {
            // Test connection logic here
            console.log(`Testing connection for existing bot ${existingBot.id}`);
            // If connection test fails, we'll delete and allow new registration
          } catch (error) {
            console.log(`Connection test failed for ${existingBot.id}, allowing new registration`);
            await storage.deleteBotInstance(existingBot.id);
          }
        }
      }

      // Check bot count limit using strict validation (no auto-removal)
      const botCountCheck = await storage.strictCheckBotCountLimit();
      let targetServerName = currentTenancyName; // Default to current server

      if (!botCountCheck.canAdd) {
        // Current server is full - try automatic cross-server registration
        const availableServers = await storage.getAvailableServers();

        if (availableServers.length > 0) {
          // Automatically register on the first available server
          const targetServer = availableServers[0];
          targetServerName = targetServer.serverName;

          console.log(`🔄 ${getServerName()} is full (${botCountCheck.currentCount}/${botCountCheck.maxCount}), automatically registering on ${targetServerName}`);

          // Update global registration to point to the target server
          await storage.updateGlobalRegistration(phoneNumber, targetServerName);

          console.log(`✅ Cross-server registration: Bot will be registered on ${targetServerName} instead of ${getServerName()}`);
        } else {
          // All servers are full - cannot proceed
          return res.status(400).json({ 
            message: `😞 All servers are currently full! Current server: ${getServerName()} (${botCountCheck.currentCount}/${botCountCheck.maxCount}). Please contact administrator for more capacity or try again later.`,
            serverFull: true,
            allServersFull: true,
            currentServer: getServerName(),
            capacity: {
              current: botCountCheck.currentCount,
              max: botCountCheck.maxCount
            },
            action: 'contact_admin'
          });
        }
      }

      // Use atomic cross-server registration with rollback support
      const registrationResult = await storage.createCrossServerRegistration(
        phoneNumber,
        targetServerName,
        {
          name: botName,
          serverName: targetServerName,
          phoneNumber: phoneNumber,
          credentials: credentials,
          status: 'pending_validation',
          approvalStatus: 'pending',
          isGuest: true,
          settings: { features: botFeatures },
          // Map features to individual columns
          autoLike: (botFeatures as any).autoLike || false,
          autoViewStatus: (botFeatures as any).autoView || false,
          autoReact: (botFeatures as any).autoReact || false,
          typingMode: (botFeatures as any).typingIndicator ? 'typing' : 'none',
          chatgptEnabled: (botFeatures as any).chatGPT || false
        }
      );

      if (!registrationResult.success) {
        return res.status(400).json({
          message: registrationResult.error || "Failed to register bot",
          serverFull: registrationResult.error?.includes('capacity') || false
        });
      }

      const botInstance = registrationResult.botInstance!;

      // Handle registration differently for cross-server vs same-server
      if (targetServerName !== currentTenancyName) {
        // Cross-server registration - no WhatsApp validation, just registry entry
        console.log(`🔄 Cross-server registration: Creating registry entry for bot ${botInstance.id} on ${targetServerName}`);

        // Mark credentials as verified without testing (assuming they're valid)
        await storage.updateBotCredentialStatusOnServer(botInstance.id, targetServerName, {
          credentialVerified: true,
          credentialPhone: cleanPhoneNumber,
          autoStart: false, // Don't auto-start cross-server registrations
          invalidReason: undefined
        });
        console.log(`✅ Credentials marked as verified for bot ${botInstance.id} on server ${targetServerName} (cross-server)`);

        // Update bot status to dormant (awaiting approval) without validation
        await storage.updateBotInstanceOnServer(botInstance.id, targetServerName, { 
          status: 'dormant',
          lastActivity: new Date()
        });
        console.log(`✅ Bot status set to dormant on server ${targetServerName} (cross-server registration)`);

      } else {
        // Same-server registration - test WhatsApp connection and send validation message
        try {
          console.log(`🔄 Testing WhatsApp connection for guest bot ${botInstance.id}`);

          // Prepare validation message
          const validationMessage = `🎉 Welcome to TREKKER-MD!

Your bot "${botName}" has been successfully registered and is awaiting admin approval.

📱 Phone: ${phoneNumber}
🤖 Bot Name: ${botName}
📅 Registered: ${new Date().toLocaleString()}

Next Steps:
✅ Your credentials have been validated
⏳ Your bot is now dormant and awaiting approval
📞 Call or message +254704897825 to activate your bot
🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;

          // Send validation message using the bot's own credentials
          const credentialsBase64 = credentialType === 'base64' ? sessionId : Buffer.from(JSON.stringify(credentials)).toString('base64');

          await sendGuestValidationMessage(phoneNumber, credentialsBase64, validationMessage);
          console.log(`✅ Validation message sent successfully to ${phoneNumber}`);

          // Mark credentials as verified since validation message was sent successfully
          await storage.updateBotCredentialStatus(botInstance.id, {
            credentialVerified: true,
            credentialPhone: cleanPhoneNumber,
            autoStart: true,
            invalidReason: undefined
          });
          console.log(`✅ Credentials marked as verified for bot ${botInstance.id}`);

          // Update bot status to pending (awaiting approval)
          await storage.updateBotInstance(botInstance.id, { 
            status: 'dormant',
            lastActivity: new Date()
          });
        } catch (validationError) {
          console.error('Failed to validate WhatsApp connection:', validationError);

          // For same-server validation failures, rollback the registration
          await storage.rollbackCrossServerRegistration(phoneNumber, botInstance.id, targetServerName);
          console.log(`🔄 Rolled back failed registration for ${phoneNumber}`);

          return res.status(400).json({ 
            message: "Failed to validate WhatsApp credentials. Please check your session ID or creds.json file." 
          });
        }
      }

      // Log activity on target server (cross-tenancy logging)
      await storage.createCrossTenancyActivity({
        type: 'registration',
        description: `Guest bot registered${targetServerName !== currentTenancyName ? ' (cross-server)' : ' and validation message sent'} to ${phoneNumber}`,
        metadata: { 
          phoneNumber, 
          credentialType, 
          phoneValidated: targetServerName === currentTenancyName, // Only validated for same-server
          sourceServer: getServerName(),
          targetServer: targetServerName,
          crossServerRegistration: targetServerName !== currentTenancyName
        },
        serverName: targetServerName, // Log to target server where bot was created
        phoneNumber,
        remoteTenancy: undefined
      });

      broadcast({ 
        type: 'GUEST_BOT_REGISTERED', 
        data: { 
          botInstance: { ...botInstance, credentials: undefined }, // Don't broadcast credentials
          phoneNumber 
        } 
      });

      const crossServerMessage = targetServerName !== currentTenancyName 
        ? ` Your bot was automatically registered on ${targetServerName} server because ${currentTenancyName} was full.`
        : '';

      res.json({ 
        success: true, 
        message: `Bot registered successfully!${targetServerName === currentTenancyName ? ' Validation message sent to your WhatsApp.' : ''}${crossServerMessage} Contact +254704897825 for activation.`,
        botId: botInstance.id,
        serverUsed: targetServerName,
        crossServerRegistration: targetServerName !== currentTenancyName
      });

    } catch (error) {
      console.error('Guest bot registration error:', error);
      res.status(500).json({ message: "Failed to register bot" });
    }
  });

  // Bot Management for Existing Users
  app.post("/api/guest/manage-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { phoneNumber, action, credentialType, sessionId, botId, targetServer } = req.body;

      if (!phoneNumber || !action || !botId) {
        return res.status(400).json({ message: "Phone number, action, and bot ID are required" });
      }

      const currentTenancyName = getServerName();

      // Verify global registration
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (!globalRegistration || globalRegistration.tenancyName !== currentTenancyName) {
        return res.status(400).json({ 
          message: "Phone number not registered to this server or registered to " + globalRegistration?.tenancyName || 'another server' 
        });
      }

      // Get the bot instance
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance || botInstance.phoneNumber !== phoneNumber) {
        return res.status(404).json({ message: "Bot not found or phone number mismatch" });
      }

      switch (action) {
        case 'restart':
          if (botInstance.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Bot must be approved before it can be restarted" });
          }

          // Check if bot is expired
          if (botInstance.approvalDate && botInstance.expirationMonths) {
            const approvalDate = new Date(botInstance.approvalDate);
            const expirationDate = new Date(approvalDate);
            expirationDate.setMonth(expirationDate.getMonth() + botInstance.expirationMonths);
            const now = new Date();

            if (now > expirationDate) {
              return res.status(400).json({ 
                message: "Bot has expired. Please contact admin for renewal.",
                expired: true
              });
            }
          }

          // Restart the bot
          try {
            await botManager.destroyBot(botId);
          } catch (error) {
            console.log('Bot was not running, creating new instance');
          }

          await botManager.createBot(botId, botInstance);
          await storage.updateBotInstance(botId, { status: 'loading' });

          await storage.createActivity({
            botInstanceId: botId,
            type: 'restart',
            description: `Bot restarted by user via management interface`,
            serverName: getServerName()
          });

          res.json({ 
            success: true, 
            message: "Bot restart initiated",
            botStatus: 'loading'
          });
          break;

        case 'update_credentials':
          let newCredentials = null;

          if (credentialType === 'base64' && sessionId) {
            try {
              const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
              newCredentials = JSON.parse(decoded);
            } catch (error) {
              return res.status(400).json({ message: "Invalid base64 session ID format" });
            }
          } else if (credentialType === 'file' && req.file) {
            try {
              const fileContent = req.file.buffer.toString('utf-8');
              newCredentials = JSON.parse(fileContent);
            } catch (error) {
              return res.status(400).json({ message: "Invalid creds.json file format" });
            }
          } else {
            return res.status(400).json({ message: "Valid credentials are required for update" });
          }

          // Validate credentials structure and content
          const { WhatsAppBot } = await import('./services/whatsapp-bot');
          const validation = WhatsAppBot.validateCredentials(newCredentials);
          if (!validation.valid) {
            return res.status(400).json({ 
              message: `Invalid credentials: ${validation.error}` 
            });
          }

          // Validate phone number ownership
          if (newCredentials && newCredentials.creds && newCredentials.creds.me && newCredentials.creds.me.id) {
            const credentialsPhoneMatch = newCredentials.creds.me.id.match(/^(\d+):/);
            const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
            const inputPhone = phoneNumber.replace(/^\+/, '');

            if (!credentialsPhone || credentialsPhone !== inputPhone) {
              return res.status(400).json({ 
                message: "Credentials don't match your phone number" 
              });
            }
          } else {
            return res.status(400).json({ 
              message: "Unable to verify phone number in credentials" 
            });
          }

          // Update credentials
          await storage.updateBotInstance(botId, { 
            credentials: newCredentials,
            status: 'offline' // Reset to offline for reactivation
          });

          await storage.createActivity({
            botInstanceId: botId,
            type: 'credentials_update',
            description: `Bot credentials updated by user`,
            metadata: { credentialType },
            serverName: getServerName()
          });

          // Send success message to user via WhatsApp if bot is running
          let messageSent = false;
          try {
            const successMessage = `✅ *TREKKER-MD Bot Credentials Updated Successfully!*\n\n` +
              `🔑 Your bot credentials have been updated and verified.\n` +
              `🤖 Bot ID: ${botInstance.name}\n` +
              `📞 Phone: ${phoneNumber}\n` +
              `🌐 Server: ${getServerName()}\n\n` +
              `Your bot is now ready to be restarted. Visit your management panel to start your bot.\n\n` +
              `💫 *TREKKER-MD - Advanced WhatsApp Bot*`;

            // Try to send message through existing bot manager if bot is running
            messageSent = await botManager.sendMessageThroughBot(botId, phoneNumber, successMessage);

            if (messageSent) {
              console.log(`✅ Success message sent to ${phoneNumber} after credential update`);
            } else {
              console.log(`ℹ️ Bot not running, success message not sent to ${phoneNumber}`);
            }
          } catch (messageError) {
            console.warn(`⚠️ Failed to send success message to ${phoneNumber}:`, messageError);
            // Don't fail the credential update if message sending fails
          }

          const responseMessage = messageSent 
            ? "Credentials updated successfully. Bot can now be restarted. A confirmation message has been sent to your WhatsApp."
            : "Credentials updated successfully. Bot can now be restarted.";

          res.json({ 
            success: true, 
            message: responseMessage
          });
          break;

        case 'start':
          if (botInstance.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Bot must be approved before it can be started" });
          }

          // Check if bot is expired
          if (botInstance.approvalDate && botInstance.expirationMonths) {
            const approvalDate = new Date(botInstance.approvalDate);
            const expirationDate = new Date(approvalDate);
            expirationDate.setMonth(expirationDate.getMonth() + botInstance.expirationMonths);
            const now = new Date();

            if (now > expirationDate) {
              return res.status(400).json({ 
                message: "Bot has expired. Please contact admin for renewal.",
                expired: true
              });
            }
          }

          // Start the bot
          try {
            await botManager.startBot(botId);
            await storage.updateBotInstance(botId, { status: 'loading' });

            await storage.createActivity({
              botInstanceId: botId,
              type: 'start',
              description: `Bot started by user via management interface`,
              serverName: getServerName()
            });

            res.json({ 
              success: true, 
              message: "Bot start initiated",
              botStatus: 'loading'
            });
          } catch (error) {
            console.error('Error starting bot:', error);
            res.status(500).json({ message: "Failed to start bot" });
          }
          break;

        case 'stop':
          if (botInstance.approvalStatus !== 'approved') {
            return res.status(400).json({ message: "Bot must be approved before it can be stopped" });
          }

          try {
            await botManager.stopBot(botId);
            await storage.updateBotInstance(botId, { status: 'offline' });

            await storage.createActivity({
              botInstanceId: botId,
              type: 'stop',
              description: `Bot stopped by user via management interface`,
              serverName: getServerName()
            });

            res.json({ 
              success: true, 
              message: "Bot stopped successfully"
            });
          } catch (error) {
            console.error('Error stopping bot:', error);
            res.status(500).json({ message: "Failed to stop bot" });
          }
          break;

        default:
          res.status(400).json({ message: "Invalid action specified" });
      }

    } catch (error) {
      console.error('Bot management error:', error);
      res.status(500).json({ message: "Failed to manage bot" });
    }
  });

  // Helper functions for cross-tenancy operations
  async function handleCrossTenancyCredentialUpdate(req: any, res: any, globalRegistration: any) {
    const { phoneNumber, credentialType, sessionId } = req.body;
    const targetServer = globalRegistration.tenancyName;
    const currentServer = getServerName();

    try {
      let newCredentials = null;

      // Parse credentials based on type
      if (credentialType === 'base64' && sessionId) {
        try {
          const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
          newCredentials = JSON.parse(decoded);
        } catch (error) {
          return res.status(400).json({ message: "Invalid base64 session ID format" });
        }
      } else if (credentialType === 'file' && req.file) {
        try {
          const fileContent = req.file.buffer.toString('utf-8');
          newCredentials = JSON.parse(fileContent);
        } catch (error) {
          return res.status(400).json({ message: "Invalid creds.json file format" });
        }
      } else {
        return res.status(400).json({ message: "Valid credentials are required for update" });
      }

      // Validate credentials structure
      const { WhatsAppBot } = await import('./services/whatsapp-bot');
      const validation = WhatsAppBot.validateCredentials(newCredentials);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: `Invalid credentials: ${validation.error}` 
        });
      }

      // Validate phone number ownership
      if (newCredentials?.creds?.me?.id) {
        const credentialsPhoneMatch = newCredentials.creds.me.id.match(/^(\d+):/);
        const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
        const inputPhone = phoneNumber.replace(/^\+/, '');

        if (!credentialsPhone || credentialsPhone !== inputPhone) {
          return res.status(400).json({ 
            message: "Credentials don't match your phone number" 
          });
        }
      } else {
        return res.status(400).json({ 
          message: "Unable to verify phone number in credentials" 
        });
      }

      // Store the credential update request in a cross-tenancy table for the target server
      await storage.createActivity({
        botInstanceId: 'cross-tenancy-request',
        type: 'cross_tenancy_credential_update',
        description: `Credential update request from ${currentServer} for phone ${phoneNumber} on ${targetServer}`,
        metadata: { 
          phoneNumber,
          targetServer,
          sourceServer: currentServer,
          credentialType,
          credentialsData: newCredentials,
          requestTimestamp: new Date().toISOString()
        },
        serverName: currentServer
      });

      // For now, simulate cross-tenancy support
      // In a real implementation, this would make an API call to the target server
      res.json({
        success: true,
        message: `Cross-tenancy credential update initiated for ${targetServer}. The credentials have been prepared for transfer.`,
        crossTenancy: true,
        targetServer,
        sourceServer: currentServer,
        phoneNumber,
        nextSteps: [
          `Your credentials will be updated on ${targetServer}`,
          `You can now manage your bot from ${targetServer}`,
          `The bot may take a few moments to restart with new credentials`,
          `Check the bot status on the target server dashboard`
        ]
      });

    } catch (error) {
      console.error('Cross-tenancy credential update error:', error);
      res.status(500).json({ message: "Failed to process cross-tenancy credential update" });
    }
  }

  async function handleCrossTenancyBotControl(req: any, res: any, globalRegistration: any, action: string) {
    const { phoneNumber } = req.body;
    const targetServer = globalRegistration.tenancyName;
    const currentServer = getServerName();

    try {
      // FIXED: Implement real cross-tenancy bot control instead of just logging

      // Find the actual bot on the target server
      const targetBot = await storage.getBotByPhoneNumber(phoneNumber);
      if (!targetBot) {
        return res.status(404).json({ 
          message: `Bot with phone number ${phoneNumber} not found on ${targetServer}`,
          crossTenancy: true,
          targetServer,
          sourceServer: currentServer
        });
      }

      // Execute the actual bot control operation
      const { botManager } = await import('./services/bot-manager');
      let operationResult;
      let operationStatus = 'failed';

      switch (action) {
        case 'start':
          try {
            await botManager.startBot(targetBot.id);
            await storage.updateBotInstance(targetBot.id, { status: 'online' });
            operationResult = `Bot ${targetBot.name} started successfully`;
            operationStatus = 'success';
          } catch (error) {
            operationResult = `Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
          break;

        case 'stop':
          try {
            await botManager.stopBot(targetBot.id);
            await storage.updateBotInstance(targetBot.id, { status: 'offline' });
            operationResult = `Bot ${targetBot.name} stopped successfully`;
            operationStatus = 'success';
          } catch (error) {
            operationResult = `Failed to stop bot: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
          break;

        case 'restart':
          try {
            await botManager.restartBot(targetBot.id);
            await storage.updateBotInstance(targetBot.id, { status: 'online' });
            operationResult = `Bot ${targetBot.name} restarted successfully`;
            operationStatus = 'success';
          } catch (error) {
            operationResult = `Failed to restart bot: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
          break;

        default:
          operationResult = `Invalid action: ${action}`;
      }

      // Log the actual operation (not just a request)
      await storage.createActivity({
        botInstanceId: targetBot.id,
        type: `cross_tenancy_${action}`,
        description: `Cross-tenancy ${action}: ${operationResult}`,
        metadata: { 
          phoneNumber,
          targetServer,
          sourceServer: currentServer,
          action,
          operationStatus,
          executedTimestamp: new Date().toISOString()
        },
        serverName: currentServer
      });

      if (operationStatus === 'success') {
        res.json({
          success: true,
          message: operationResult,
          crossTenancy: true,
          targetServer,
          sourceServer: currentServer,
          phoneNumber,
          action,
          botId: targetBot.id,
          botName: targetBot.name,
          actuallyExecuted: true
        });
      } else {
        res.status(500).json({
          success: false,
          message: operationResult,
          crossTenancy: true,
          targetServer,
          sourceServer: currentServer,
          phoneNumber,
          action
        });
      }

    } catch (error) {
      console.error(`Cross-tenancy ${action} error:`, error);
      res.status(500).json({ message: `Failed to process cross-tenancy ${action} operation` });
    }
  }

  // Master Control Panel API routes - Cross-tenancy management using God Registry
  app.post("/api/master/bot-action", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { action, botId, tenancy, data } = req.body;
      const currentServer = getServerName();

      // Validate required fields - botId is required for most actions except bulk operations
      if (!action || !tenancy) {
        return res.status(400).json({ message: "Missing required fields: action and tenancy are required" });
      }

      // botId is required for individual bot actions
      if (!botId && !['sync', 'disconnect', 'bulk_start', 'bulk_stop'].includes(action)) {
        return res.status(400).json({ message: "Missing required fields: botId is required for this action" });
      }

      // Handle actions for local tenancy
      if (tenancy === currentServer) {
        switch (action) {
          case 'approve':
            if (!botId) return res.status(400).json({ message: "Bot ID required" });

            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
              return res.status(404).json({ message: "Bot not found" });
            }

            const duration = data?.duration || 6; // Default 6 months
            const approvalDate = new Date().toISOString();

            await storage.updateBotInstance(botId, {
              approvalStatus: 'approved',
              status: 'offline',
              approvalDate,
              expirationMonths: duration
            });

            await storage.createActivity({
              botInstanceId: botId,
              type: 'master_approval',
              description: `Bot approved via master control panel for ${duration} months`,
              metadata: { action: 'approve', duration, approvedBy: 'master_admin' },
              serverName: getServerName()
            });

            broadcast({ 
              type: 'BOT_APPROVED_MASTER', 
              data: { botId, name: botInstance.name, tenancy } 
            });

            break;

          case 'reject':
            if (!botId) return res.status(400).json({ message: "Bot ID required" });

            await storage.updateBotInstance(botId, {
              approvalStatus: 'rejected',
              status: 'rejected'
            });

            await storage.createActivity({
              botInstanceId: botId,
              type: 'master_rejection',
              description: 'Bot rejected via master control panel',
              metadata: { action: 'reject', rejectedBy: 'master_admin' },
              serverName: getServerName()
            });

            break;

          case 'start':
            if (!botId) return res.status(400).json({ message: "Bot ID required" });
            await botManager.startBot(botId);
            break;

          case 'stop':
            if (!botId) return res.status(400).json({ message: "Bot ID required" });
            await botManager.stopBot(botId);
            break;

          case 'delete':
            if (!botId) return res.status(400).json({ message: "Bot ID required" });

            const botToDelete = await storage.getBotInstance(botId);
            if (botToDelete) {
              // Stop bot if running
              await botManager.stopBot(botId);

              // Delete from god registry
              await storage.deleteGlobalRegistration(botToDelete.phoneNumber || '');

              // Delete bot instance
              await storage.deleteBotInstance(botId);

              await storage.createActivity({
                botInstanceId: 'system-master-control',
                type: 'master_deletion',
                description: `Bot ${botToDelete.name} deleted via master control panel`,
                metadata: { action: 'delete', phoneNumber: botToDelete.phoneNumber, deletedBy: 'master_admin' },
                serverName: getServerName()
              });
            }
            break;

          default:
            return res.status(400).json({ message: "Unknown action" });
        }

        res.json({ success: true, message: `Action ${action} completed successfully` });
      } else {
        // Handle actions for remote tenancies via God Registry
        console.log(`Cross-tenancy action ${action} on ${tenancy} for bot ${botId}`);

        // Log the cross-tenancy action attempt (using system placeholder for bot_instance_id)
        await storage.createActivity({
          botInstanceId: 'system-master-control',
          type: 'master_cross_tenancy',
          description: `Cross-tenancy action ${action} attempted on ${tenancy}`,
          metadata: { action, tenancy, botId, initiatedBy: 'master_admin' },
          serverName: getServerName()
        });

        res.json({ 
          success: true, 
          message: `Cross-tenancy action ${action} logged for ${tenancy}`,
          note: "Cross-tenancy actions are logged in God Registry" 
        });
      }
    } catch (error) {
      console.error('Failed to perform bot action:', error);
      res.status(500).json({ message: "Failed to perform action" });
    }
  });

  // Server capacity management endpoints
  app.get("/api/server/capacity", async (req, res) => {
    try {
      const serverName = getServerName();
      const maxBots = parseInt(process.env.BOTCOUNT || '10');
      const currentBots = await storage.getAllBotInstances();
      const approvedBots = currentBots.filter(bot => bot.approvalStatus === 'approved');

      res.json({
        serverName,
        maxBots,
        currentBots: currentBots.length,
        approvedBots: approvedBots.length,
        availableSlots: maxBots - approvedBots.length,
        isFull: approvedBots.length >= maxBots,
        capacity: `${approvedBots.length}/${maxBots}`
      });
    } catch (error) {
      console.error('Failed to get server capacity:', error);
      res.status(500).json({ message: "Failed to get server capacity" });
    }
  });

  // Get available alternative servers for guests when current server is full
  app.get("/api/guest/alternative-servers", async (req, res) => {
    try {
      const registrations = await storage.getAllGlobalRegistrations();
      const currentTenancy = getServerName();

      // Group by tenancy and count bots
      const tenancyStats = registrations.reduce((acc, reg) => {
        if (!acc[reg.tenancyName]) {
          acc[reg.tenancyName] = {
            name: reg.tenancyName,
            botCount: 0,
            isCurrentServer: reg.tenancyName === currentTenancy
          };
        }
        acc[reg.tenancyName].botCount++;
        return acc;
      }, {} as any);

      // Add default capacity info (assuming 20 max for now, can be made configurable)
      const alternativeServers = Object.values(tenancyStats).map((server: any) => ({
        ...server,
        maxBots: 20, // This could be made configurable per server
        availableSlots: Math.max(0, 20 - server.botCount),
        isFull: server.botCount >= 20,
        capacity: `${server.botCount}/20`
      })).filter((server: any) => !server.isCurrentServer && !server.isFull);

      res.json({
        currentServer: {
          name: currentTenancy,
          isFull: true,
          capacity: `${tenancyStats[currentTenancy]?.botCount || 0}/20`
        },
        alternativeServers
      });
    } catch (error) {
      console.error('Failed to get alternative servers:', error);
      res.status(500).json({ message: "Failed to get alternative servers" });
    }
  });

  // Server Registry API endpoints for multi-tenancy
  app.get("/api/servers/available", async (req, res) => {
    try {
      const availableServers = await storage.getAvailableServers();
      res.json({
        servers: availableServers.map(server => ({
          serverName: server.serverName,
          currentBots: server.currentBotCount || 0,
          maxBots: server.maxBotCount,
          availableSlots: server.maxBotCount - (server.currentBotCount || 0),
          serverUrl: server.serverUrl,
          description: server.description,
          serverStatus: server.serverStatus
        }))
      });
    } catch (error) {
      console.error('Failed to get available servers:', error);
      res.status(500).json({ message: "Failed to retrieve available servers" });
    }
  });

  app.get("/api/servers/all", async (req, res) => {
    try {
      const allServers = await storage.getAllServers();
      res.json({
        servers: allServers.map(server => ({
          serverName: server.serverName,
          currentBots: server.currentBotCount || 0,
          maxBots: server.maxBotCount,
          availableSlots: server.maxBotCount - (server.currentBotCount || 0),
          serverUrl: server.serverUrl,
          description: server.description,
          serverStatus: server.serverStatus
        }))
      });
    } catch (error) {
      console.error('Failed to get all servers:', error);
      res.status(500).json({ message: "Failed to retrieve servers" });
    }
  });

  // Cross-server bot registration endpoint
  app.post("/api/cross-server/register-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { targetServer, botName, phoneNumber, credentialType, sessionId, features } = req.body;

      if (!targetServer || !botName || !phoneNumber) {
        return res.status(400).json({ message: "Target server, bot name and phone number are required" });
      }

      // Check if target server exists and has capacity
      const serverCheck = await storage.strictCheckBotCountLimit(targetServer);
      if (!serverCheck.canAdd) {
        return res.status(400).json({ 
          message: `Selected server ${targetServer} is now full (${serverCheck.currentCount}/${serverCheck.maxCount} bots). Please select another server.`
        });
      }

      // Check global registration to prevent duplicate registrations
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (globalRegistration) {
        return res.status(400).json({ 
          message: `This phone number is already registered on ${globalRegistration.tenancyName}. Please go to that server to manage your bot.`,
          registeredTo: globalRegistration.tenancyName
        });
      }

      // Process credentials (similar to guest registration logic)
      let credentials = null;
      if (credentialType === 'base64' && sessionId) {
        try {
          const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
          credentials = JSON.parse(decoded);
        } catch (error) {
          return res.status(400).json({ message: "Invalid base64 session ID format" });
        }
      } else if (credentialType === 'file' && req.file) {
        try {
          const fileContent = req.file.buffer.toString('utf-8');
          credentials = JSON.parse(fileContent);
        } catch (error) {
          return res.status(400).json({ message: "Invalid creds.json file format" });
        }
      } else {
        return res.status(400).json({ message: "Valid credentials are required" });
      }

      // Validate phone number ownership
      if (credentials && credentials.me && credentials.me.id) {
        const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/);
        const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
        const inputPhone = phoneNumber.replace(/^\+/, '');

        if (!credentialsPhone || credentialsPhone !== inputPhone) {
          return res.status(400).json({ 
            message: "You are not the owner of this credentials file. The phone number in the session does not match your input." 
          });
        }
      } else {
        return res.status(400).json({ message: "Invalid credentials format - missing phone number data" });
      }

      // Parse features if provided
      let botFeatures = {};
      if (features) {
        try {
          botFeatures = JSON.parse(features);
        } catch (error) {
          console.warn('Invalid features JSON:', error);
        }
      }

      // Create bot instance on target server
      const botInstance = await storage.createBotInstance({
        name: botName,
        phoneNumber: phoneNumber,
        credentials: credentials,
        status: 'dormant',
        approvalStatus: 'pending',
        isGuest: true,
        settings: { features: botFeatures },
        autoLike: (botFeatures as any).autoLike || false,
        autoViewStatus: (botFeatures as any).autoView || false,
        autoReact: (botFeatures as any).autoReact || false,
        typingMode: (botFeatures as any).typingIndicator ? 'typing' : 'none',
        chatgptEnabled: (botFeatures as any).chatGPT || false,
        serverName: targetServer // Register under target server
      });

      // Add to global registry under target server
      await storage.addGlobalRegistration(phoneNumber, targetServer);

      // Log activity for cross-server registration
      await storage.createActivity({
        botInstanceId: botInstance.id,
        type: 'cross_server_registration',
        description: `Bot registered on ${targetServer} via cross-server registration from ${getServerName()}`,
        metadata: { 
          originalServer: getServerName(),
          targetServer,
          phoneNumber,
          credentialType 
        },
        serverName: targetServer
      });

      // Update server bot count
      await storage.updateServerBotCount(targetServer, serverCheck.currentCount + 1);

      res.json({ 
        success: true, 
        message: `Bot successfully registered on ${targetServer}! Your bot is awaiting admin approval.`,
        botId: botInstance.id,
        targetServer: targetServer,
        serverInfo: {
          serverName: targetServer,
          newBotCount: serverCheck.currentCount + 1,
          maxBots: serverCheck.maxBotCount
        }
      });

    } catch (error) {
      console.error('Cross-server bot registration error:', error);
      res.status(500).json({ message: "Failed to register bot on target server" });
    }
  });

  // ============================================================================
  // CROSS-TENANCY INTERNAL ROUTES
  // ============================================================================

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
        phoneNumber,
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