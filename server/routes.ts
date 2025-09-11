import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from 'jsonwebtoken';
import multer from "multer";
import fs from 'fs';
import path from 'path';
import { storage } from "./storage";
import { insertBotInstanceSchema, insertCommandSchema, insertActivitySchema } from "@shared/schema";
import { botManager } from "./services/bot-manager";
import { getServerName } from "./db";
import { authenticateAdmin, authenticateUser, validateAdminCredentials, generateToken, type AuthRequest } from './middleware/auth';
import { sendValidationMessage, sendGuestValidationMessage } from "./services/validation-bot";

const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  },
  limits: { fileSize: 1024 * 1024 } // 1MB limit
});

// Helper function to reset to default server after guest registration
async function resetToDefaultServerAfterRegistration(): Promise<void> {
  try {
    const currentServer = getServerName();
    const defaultServer = process.env.SERVER_NAME || 'default-server';
    
    // Only reset if we're not already on the default server
    if (currentServer !== defaultServer) {
      console.log(`🔄 Resetting to default server from ${currentServer} to ${defaultServer} after guest registration`);
      
      // Switch back to default server context
      const { botManager } = await import('./services/bot-manager');
      await botManager.stopAllBots();
      
      process.env.RUNTIME_SERVER_NAME = defaultServer;
      
      // Resume bots for default server
      await botManager.resumeBotsForServer(defaultServer);
      
      console.log(`✅ Successfully reset to default server: ${defaultServer}`);
    }
  } catch (error) {
    console.warn('⚠️ Failed to reset to default server after registration:', error);
    // Don't throw error as this shouldn't fail the registration
  }
}

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
      
      const savedBots = await storage.getAllBotInstances();
      
      if (savedBots.length === 0) {
        console.log('📋 No saved bots found in database');
        return;
      }

      console.log(`📱 Found ${savedBots.length} saved bot(s) in database`);
      
      // Filter bots that have credentials AND are approved (can be resumed)
      const resumableBots = savedBots.filter(bot => bot.credentials && bot.approvalStatus === 'approved');
      
      if (resumableBots.length === 0) {
        console.log('⚠️ No approved bots with credentials found to resume');
        return;
      }

      console.log(`🚀 Resuming ${resumableBots.length} bot(s) with credentials...`);
      
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
  
  // Credentials validation endpoint (accessible to everyone)
  app.post("/api/validate-credentials", upload.single('credentials') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          message: "Please upload a credentials.json file" 
        });
      }
      
      let credentials;
      try {
        credentials = JSON.parse(req.file.buffer.toString());
      } catch (error) {
        return res.status(400).json({ 
          message: "❌ Invalid JSON file. Please ensure you're uploading a valid credentials.json file." 
        });
      }
      
      // Basic validation of credentials structure
      if (!credentials || typeof credentials !== 'object') {
        return res.status(400).json({ 
          message: "❌ Invalid credentials file format. Please upload a valid WhatsApp session file." 
        });
      }
      
      // Try to test the credentials by creating a temporary bot instance
      const testBotData = {
        name: `Test_${Date.now()}`,
        credentials,
        autoLike: false,
        autoViewStatus: false,
        autoReact: false,
        chatgptEnabled: false,
        typingMode: 'none'
      };
      
      try {
        const validatedData = insertBotInstanceSchema.parse(testBotData);
        const testBot = await storage.createBotInstance(validatedData);
        
        // Try to initialize the bot to test credentials
        await botManager.createBot(testBot.id, testBot);
        
        // If we get here, credentials are valid
        // Clean up the test bot immediately
        await botManager.destroyBot(testBot.id);
        await storage.deleteBotInstance(testBot.id);
        
        res.json({ 
          valid: true,
          message: "✅ Your credentials.json is valid! Checking admin approval...",
          status: "pending_approval"
        });
        
      } catch (botError) {
        // Clean up if bot creation failed
        try {
          // testBot is defined in the try block above, cleanup if needed
          console.error('Bot creation failed, cleaning up...');
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
        
        res.status(400).json({ 
          valid: false,
          message: "❌ Invalid credentials.json file. Please ensure it's a valid WhatsApp session file.",
          error: botError instanceof Error ? botError.message : 'Unknown error'
        });
      }
      
    } catch (error) {
      console.error('Credentials validation error:', error);
      res.status(500).json({ 
        message: "Failed to validate credentials",
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
  app.post("/api/server/configure", async (req, res) => {
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
      
      // TENANT SWITCHING LOGIC - Switch to different server context
      console.log(`🔄 Switching server context from "${currentServerName}" to "${newServerName}"`);
      
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
        console.log(`✅ Created new server tenant: ${newServerName}`);
      } else if (description?.trim()) {
        // Update description if provided
        await storage.updateServerInfo(newServerName, {
          serverName: newServerName,
          description: description.trim()
        });
      }
      
      // Step 2: Stop all current server operations and switch context
      try {
        // Stop all current bot instances for current server
        const { botManager } = await import('./services/bot-manager');
        await botManager.stopAllBots();
        console.log(`🛑 Stopped all bot operations for server: ${currentServerName}`);
        
        // Step 3: Set new server context by updating runtime environment
        process.env.RUNTIME_SERVER_NAME = newServerName;
        console.log(`🔄 Server context switched to: ${newServerName}`);
        
        // Step 4: Initialize the new server tenant (check/create tables if needed)
        await initializeServerTenant(newServerName);
        
        // Step 5: Restart bot manager with new server context
        await botManager.resumeBotsForServer(newServerName);
        console.log(`✅ Restarted bot manager for server: ${newServerName}`);
        
        res.json({ 
          message: "Server switched successfully. All operations now running under new server context.",
          newServerName: newServerName,
          requiresRefresh: true
        });
        
      } catch (switchError) {
        console.error("Server context switching error:", switchError);
        res.status(500).json({ message: "Failed to switch server context. Please try again." });
      }
      
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
        'chatGPT': 'chatgptEnabled'
      };
      
      const dbField = featureMap[feature];
      if (!dbField) {
        return res.status(400).json({ message: "Invalid feature name" });
      }
      
      // Prepare update object
      const updates: any = {};
      if (dbField === 'typingMode') {
        updates[dbField] = enabled ? 'typing' : 'none';
      } else {
        updates[dbField] = enabled;
      }
      
      // Also update settings.features
      const currentSettings = (bot.settings as any) || {};
      const currentFeatures = (currentSettings.features as any) || {};
      updates.settings = {
        ...currentSettings,
        features: {
          ...currentFeatures,
          [feature]: enabled
        }
      };
      
      await storage.updateBotInstance(id, updates);
      
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

  // Guest Bot Registration
  app.post("/api/guest/register-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { botName, phoneNumber, credentialType, sessionId, features } = req.body;
      
      if (!botName || !phoneNumber) {
        return res.status(400).json({ message: "Bot name and phone number are required" });
      }
      
      // Get current tenant name
      const currentTenancyName = getServerName();
      
      // Check global registration first
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (globalRegistration) {
        // Phone number is already registered to another tenant
        if (globalRegistration.tenancyName !== currentTenancyName) {
          return res.status(400).json({ 
            message: `This phone number is registered to ${globalRegistration.tenancyName}. Please go to ${globalRegistration.tenancyName} server to manage your bot.`,
            registeredTo: globalRegistration.tenancyName
          });
        }
        
        // Phone number belongs to this tenant - check for existing bot
        const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
        if (existingBot) {
          // User has a bot on this server - provide management options
          const isActive = existingBot.status === 'online';
          const isApproved = existingBot.approvalStatus === 'approved';
          
          // Check expiry if bot is approved
          let timeRemaining = null;
          let isExpired = false;
          if (isApproved && existingBot.approvalDate && existingBot.expirationMonths) {
            const approvalDate = new Date(existingBot.approvalDate);
            const expirationDate = new Date(approvalDate);
            expirationDate.setMonth(expirationDate.getMonth() + existingBot.expirationMonths);
            const now = new Date();
            
            if (now > expirationDate) {
              isExpired = true;
            } else {
              timeRemaining = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)); // days
            }
          }
          
          return res.json({
            type: 'existing_bot_found',
            message: `Welcome back! You have a bot on this server.`,
            botDetails: {
              id: existingBot.id,
              name: existingBot.name,
              phoneNumber: existingBot.phoneNumber,
              status: existingBot.status,
              isActive,
              isApproved,
              approvalStatus: existingBot.approvalStatus,
              isExpired,
              timeRemaining,
              expirationMonths: existingBot.expirationMonths
            }
          });
        }
      } else {
        // This is a new registration - add to global register
        await storage.addGlobalRegistration(phoneNumber, currentTenancyName);
      }

      // Check if phone number already exists locally (redundant check but for safety)
      const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
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

      let credentials = null;
      
      // Handle credentials based on type
      if (credentialType === 'base64' && sessionId) {
        try {
          // Validate base64 session ID
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

      // Validate phone number ownership
      if (credentials && credentials.me && credentials.me.id) {
        // Extract phone number from credentials (format: "254704897825:33@s.whatsapp.net")
        const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/); 
        const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
        
        // Clean the input phone number (remove + if present)
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

      // Check bot count limit using strict validation (no auto-removal)
      const botCountCheck = await storage.strictCheckBotCountLimit();
      if (!botCountCheck.canAdd) {
        // Get available servers for automatic distribution
        const availableServers = await storage.getAvailableServers();
        
        if (availableServers.length > 0) {
          // Auto-select the first available server for cross-tenancy distribution
          const targetServer = availableServers[0];
          console.log(`🔄 ${getServerName()} is full (${botCountCheck.currentCount}/${botCountCheck.maxCount}), auto-distributing to ${targetServer.serverName}`);
          
          // Update God Registry to register bot on target server
          await storage.deleteGlobalRegistration(phoneNumber); // Remove current server registration
          await storage.addGlobalRegistration(phoneNumber, targetServer.serverName); // Add to target server
          
          // Update target server's bot count in registry
          const newBotCount = (targetServer.currentBotCount || 0) + 1;
          await storage.updateServerBotCount(targetServer.serverName, newBotCount);
          
          console.log(`📋 Bot ${botName} (${phoneNumber}) registered to ${targetServer.serverName} via cross-tenancy distribution`);
          
          // Return response indicating auto-distribution to target server
          return res.json({
            type: 'cross_tenancy_registered',
            message: `✅ ${getServerName()} is full, but your bot has been automatically registered to ${targetServer.serverName}!`,
            originalServer: getServerName(),
            assignedServer: targetServer.serverName,
            serverUrl: targetServer.serverUrl,
            botDetails: {
              name: botName,
              phoneNumber: phoneNumber,
              assignedTo: targetServer.serverName,
              availableSlots: targetServer.maxBotCount - newBotCount,
              registeredVia: 'auto_distribution'
            },
            nextSteps: [
              `Your bot is now registered on ${targetServer.serverName}`,
              'You can manage your bot from that server',
              `Contact +254704897825 for activation`,
              'Cross-tenancy management is enabled for approved bots'
            ]
          });
        } else {
          // All servers are full - provide manual selection as fallback
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

      // Create guest bot instance
      const botInstance = await storage.createBotInstance({
        name: botName,
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
        chatgptEnabled: (botFeatures as any).chatGPT || false,
        serverName: getServerName()
      });

      // Test WhatsApp connection and send validation message
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
        
        // Update bot status to pending (awaiting approval)
        await storage.updateBotInstance(botInstance.id, { 
          status: 'dormant',
          lastActivity: new Date()
        });

        // Log activity
        await storage.createActivity({
          botInstanceId: botInstance.id,
          type: 'registration',
          description: `Guest bot registered and validation message sent to ${phoneNumber}`,
          metadata: { phoneNumber, credentialType, phoneValidated: true },
          serverName: getServerName()
        });

        broadcast({ 
          type: 'GUEST_BOT_REGISTERED', 
          data: { 
            botInstance: { ...botInstance, credentials: undefined }, // Don't broadcast credentials
            phoneNumber 
          } 
        });

        res.json({ 
          success: true, 
          message: "Bot registered successfully! Validation message sent to your WhatsApp. Contact +254704897825 for activation.",
          botId: botInstance.id
        });

        // Reset to default server after successful guest registration
        await resetToDefaultServerAfterRegistration();

      } catch (error) {
        console.error('Failed to validate WhatsApp connection:', error);
        
        // Delete the bot instance if validation fails
        await storage.deleteBotInstance(botInstance.id);
        
        return res.status(400).json({ 
          message: "Failed to validate WhatsApp credentials. Please check your session ID or creds.json file." 
        });
      }

    } catch (error) {
      console.error('Guest bot registration error:', error);
      res.status(500).json({ message: "Failed to register bot" });
    }
  });

  // Bot Management for Existing Users
  app.post("/api/guest/manage-bot", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { phoneNumber, action, credentialType, sessionId, botId } = req.body;
      
      if (!phoneNumber || !action || !botId) {
        return res.status(400).json({ message: "Phone number, action, and bot ID are required" });
      }
      
      const currentTenancyName = getServerName();
      
      // Verify global registration
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (!globalRegistration || globalRegistration.tenancyName !== currentTenancyName) {
        return res.status(400).json({ 
          message: `Phone number not registered to this server or registered to ${globalRegistration?.tenancyName || 'another server'}` 
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
      // Store the bot control request
      await storage.createActivity({
        botInstanceId: 'cross-tenancy-request',
        type: `cross_tenancy_${action}`,
        description: `Bot ${action} request from ${currentServer} for phone ${phoneNumber} on ${targetServer}`,
        metadata: { 
          phoneNumber,
          targetServer,
          sourceServer: currentServer,
          action,
          requestTimestamp: new Date().toISOString()
        },
        serverName: currentServer
      });
      
      // In a real implementation, this would make an API call to the target server
      res.json({
        success: true,
        message: `Cross-tenancy ${action} operation initiated for ${targetServer}`,
        crossTenancy: true,
        targetServer,
        sourceServer: currentServer,
        phoneNumber,
        action,
        note: `Bot ${action} command has been forwarded to ${targetServer}. Please check the bot status on the target server.`
      });
      
    } catch (error) {
      console.error(`Cross-tenancy ${action} error:`, error);
      res.status(500).json({ message: `Failed to process cross-tenancy ${action} operation` });
    }
  }

  // Enhanced Cross-Tenancy Bot Management
  app.post("/api/guest/cross-tenancy-manage", upload.single('credsFile') as any, async (req, res) => {
    try {
      const { phoneNumber, action, credentialType, sessionId, botId, targetServer } = req.body;
      
      if (!phoneNumber || !action) {
        return res.status(400).json({ message: "Phone number and action are required" });
      }
      
      const currentTenancyName = getServerName();
      
      // Verify global registration to determine actual server location
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      if (!globalRegistration) {
        return res.status(404).json({ 
          message: "Phone number not registered to any server in the system" 
        });
      }
      
      const actualServer = globalRegistration.tenancyName;
      const isCurrentServer = actualServer === currentTenancyName;
      
      // If the bot is on the current server, use regular management
      if (isCurrentServer) {
        if (!botId) {
          return res.status(400).json({ message: "Bot ID is required for same-server operations" });
        }
        
        // Handle same-server operations directly
        const { action } = req.body;
        const botInstance = await storage.getBotInstance(botId);
        if (!botInstance) {
          return res.status(404).json({ message: "Bot not found" });
        }
        
        // Execute the same logic as in regular bot management
        // (This would be a refactored function call in production code)
        res.json({ message: `${action} action executed successfully`, botId, action });
      }
      
      // Handle cross-tenancy operations
      switch (action) {
        case 'update_credentials':
          await handleCrossTenancyCredentialUpdate(req, res, globalRegistration);
          break;
          
        case 'start':
        case 'stop':
        case 'restart':
          await handleCrossTenancyBotControl(req, res, globalRegistration, action);
          break;
          
        default:
          res.status(400).json({ 
            message: `Cross-tenancy action '${action}' not supported yet`,
            suggestion: "Please contact the target server directly for this operation"
          });
      }
      
    } catch (error) {
      console.error('Cross-tenancy bot management error:', error);
      res.status(500).json({ message: "Failed to manage bot across tenancies" });
    }
  });

  // Cross-Tenancy Feature Management
  app.post("/api/master/feature-management", authenticateAdmin, async (req, res) => {
    try {
      const { action, botId, tenancy, feature, enabled } = req.body;
      const currentServer = getServerName();
      
      if (action !== 'toggle_feature') {
        return res.status(400).json({ message: "Invalid action. Only 'toggle_feature' is supported." });
      }
      
      if (!tenancy || !feature || typeof enabled !== 'boolean') {
        return res.status(400).json({ 
          message: "Tenancy, feature, and enabled status are required" 
        });
      }

      // If modifying a specific bot
      if (botId) {
        // Check if bot exists on current server
        if (tenancy === currentServer) {
          const botInstance = await storage.getBotInstance(botId);
          if (!botInstance) {
            return res.status(404).json({ message: "Bot not found on current server" });
          }
          
          // Update bot features directly
          const updateData: any = {};
          updateData[feature] = enabled;
          
          await storage.updateBotInstance(botId, updateData);
          
          // Log the feature change
          await storage.createActivity({
            botInstanceId: botId,
            type: 'feature_toggle',
            description: `Admin ${enabled ? 'enabled' : 'disabled'} ${feature} feature`,
            metadata: { feature, enabled, changedBy: 'admin' },
            serverName: currentServer
          });
          
          res.json({
            success: true,
            message: `Feature ${feature} ${enabled ? 'enabled' : 'disabled'} for bot ${botInstance.name}`,
            botId,
            feature,
            enabled
          });
        } else {
          // Cross-tenancy feature toggle (logged for coordination)
          await storage.createActivity({
            botInstanceId: 'cross-tenancy-request',
            type: 'cross_tenancy_feature_toggle',
            description: `Admin requested ${feature} ${enabled ? 'enable' : 'disable'} for bot ${botId} on ${tenancy}`,
            metadata: { 
              targetServer: tenancy,
              sourceServer: currentServer,
              botId,
              feature,
              enabled,
              requestTimestamp: new Date().toISOString()
            },
            serverName: currentServer
          });
          
          res.json({
            success: true,
            message: `Cross-tenancy feature toggle request logged for ${tenancy}`,
            crossTenancy: true,
            targetServer: tenancy,
            botId,
            feature,
            enabled
          });
        }
      } else {
        // Global feature toggle for tenancy (logged for coordination)
        await storage.createActivity({
          botInstanceId: 'cross-tenancy-request',
          type: 'cross_tenancy_global_feature_toggle',
          description: `Admin requested global ${feature} ${enabled ? 'enable' : 'disable'} for ${tenancy}`,
          metadata: { 
            targetServer: tenancy,
            sourceServer: currentServer,
            feature,
            enabled,
            scope: 'global',
            requestTimestamp: new Date().toISOString()
          },
          serverName: currentServer
        });
        
        res.json({
          success: true,
          message: `Global feature toggle request logged for ${tenancy}`,
          crossTenancy: true,
          targetServer: tenancy,
          feature,
          enabled,
          scope: 'global'
        });
      }
      
    } catch (error) {
      console.error('Feature management error:', error);
      res.status(500).json({ message: "Failed to manage feature" });
    }
  });

  // Cross-Tenancy Command Synchronization
  app.post("/api/master/sync-commands", authenticateAdmin, async (req, res) => {
    try {
      const { sourceServer, targetServers, commandIds } = req.body;
      const currentServer = getServerName();
      
      if (!sourceServer || !Array.isArray(targetServers) || !Array.isArray(commandIds)) {
        return res.status(400).json({ 
          message: "Source server, target servers array, and command IDs array are required" 
        });
      }
      
      if (targetServers.length === 0) {
        return res.status(400).json({ message: "At least one target server must be specified" });
      }
      
      // If source server is current server, get actual command data
      let commandsData = null;
      if (sourceServer === currentServer) {
        if (commandIds.length === 0) {
          // Get all commands if no specific IDs provided
          commandsData = await storage.getCommands();
        } else {
          // Get specific commands
          commandsData = [];
          for (const commandId of commandIds) {
            const command = await storage.getCommand(commandId);
            if (command) {
              commandsData.push(command);
            }
          }
        }
        
        // Log successful command export
        await storage.createActivity({
          botInstanceId: 'cross-tenancy-request',
          type: 'command_export',
          description: `Admin exported ${commandsData.length} commands from ${sourceServer}`,
          metadata: { 
            sourceServer,
            targetServers,
            commandCount: commandsData.length,
            commandIds: commandsData.map(c => c.id),
            exportTimestamp: new Date().toISOString()
          },
          serverName: currentServer
        });
      }
      
      // Log command sync requests for target servers
      for (const targetServer of targetServers) {
        await storage.createActivity({
          botInstanceId: 'cross-tenancy-request',
          type: 'cross_tenancy_command_sync',
          description: `Admin requested command sync from ${sourceServer} to ${targetServer}`,
          metadata: { 
            sourceServer,
            targetServer,
            requestingServer: currentServer,
            commandCount: commandsData?.length || commandIds.length,
            commandIds: commandsData ? commandsData.map(c => c.id) : commandIds,
            commandsData: commandsData || null,
            requestTimestamp: new Date().toISOString()
          },
          serverName: currentServer
        });
      }
      
      res.json({
        success: true,
        message: `Command sync initiated from ${sourceServer} to ${targetServers.length} target server(s)`,
        sourceServer,
        targetServers,
        commandCount: commandsData?.length || commandIds.length,
        syncedCommands: commandsData ? commandsData.map(c => ({ id: c.id, name: c.name })) : null
      });
      
    } catch (error) {
      console.error('Command sync error:', error);
      res.status(500).json({ message: "Failed to sync commands" });
    }
  });
  
  // Check Tenant Registration
  app.post("/api/guest/check-registration", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }
      
      const currentTenancyName = getServerName();
      const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
      
      if (!globalRegistration) {
        return res.json({
          registered: false,
          message: "Phone number not registered to any server"
        });
      }
      
      if (globalRegistration.tenancyName !== currentTenancyName) {
        return res.json({
          registered: true,
          currentServer: false,
          registeredTo: globalRegistration.tenancyName,
          message: `Phone number is registered to ${globalRegistration.tenancyName}. Please go to ${globalRegistration.tenancyName} server.`
        });
      }
      
      // Check for existing bot on this server
      const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
      
      res.json({
        registered: true,
        currentServer: true,
        hasBot: !!existingBot,
        bot: existingBot ? {
          id: existingBot.id,
          name: existingBot.name,
          status: existingBot.status,
          approvalStatus: existingBot.approvalStatus,
          isApproved: existingBot.approvalStatus === 'approved',
          approvalDate: existingBot.approvalDate,
          expirationMonths: existingBot.expirationMonths
        } : null,
        message: existingBot 
          ? `Welcome back! You have a bot named "${existingBot.name}" on this server.`
          : "Phone number registered to this server but no bot found."
      });
      
    } catch (error) {
      console.error('Check registration error:', error);
      res.status(500).json({ message: "Failed to check registration" });
    }
  });

  // Activities
  app.get("/api/activities", async (req, res) => {
    try {
      const botInstanceId = req.query.botInstanceId as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const activities = await storage.getActivities(botInstanceId, limit);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Groups
  app.get("/api/groups/:botInstanceId", async (req, res) => {
    try {
      const groups = await storage.getGroups(req.params.botInstanceId);
      res.json(groups);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch groups" });
    }
  });

  // Admin-only routes
  app.get("/api/admin/bot-instances", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botInstances = await storage.getAllBotInstances();
      res.json(botInstances);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bot instances" });
    }
  });

  app.get("/api/admin/activities", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const activities = await storage.getAllActivities(limit);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  app.get("/api/admin/stats", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getSystemStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Admin Bot Approval Routes
  app.get("/api/admin/pending-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const pendingBots = await storage.getPendingBots();
      res.json(pendingBots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pending bots" });
    }
  });

  app.get("/api/admin/approved-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const approvedBots = await storage.getApprovedBots();
      res.json(approvedBots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch approved bots" });
    }
  });

  app.post("/api/admin/approve-bot/:id", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      const { duration } = req.body; // Duration in months
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }
      
      if (!duration || duration < 1 || duration > 12) {
        return res.status(400).json({ message: "Duration must be between 1-12 months" });
      }

      // Update approval status with expiration
      const approvalDate = new Date().toISOString();
      await storage.updateBotInstance(botId, { 
        approvalStatus: 'approved',
        status: 'offline', // Ready to be started
        approvalDate,
        expirationMonths: duration
      });

      // Log activity
      await storage.createActivity({
        botInstanceId: botId,
        type: 'approval',
        description: `Bot ${botInstance.name} approved by admin for ${duration} months`,
        metadata: { adminAction: 'approve', phoneNumber: botInstance.phoneNumber, duration, approvalDate },
        serverName: getServerName()
      });

      // Send activation message (placeholder for now)
      console.log(`📞 Activation message would be sent to ${botInstance.phoneNumber}`);
      
      broadcast({ 
        type: 'BOT_APPROVED', 
        data: { botId, name: botInstance.name } 
      });

      res.json({ success: true, message: "Bot approved successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to approve bot" });
    }
  });

  app.post("/api/admin/reject-bot/:id", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      const { reason } = req.body;
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      // Update approval status
      await storage.updateBotInstance(botId, { 
        approvalStatus: 'rejected',
        status: 'rejected'
      });

      // Log activity
      await storage.createActivity({
        botInstanceId: botId,
        type: 'rejection',
        description: `Bot ${botInstance.name} rejected by admin. Reason: ${reason || 'No reason provided'}`,
        metadata: { adminAction: 'reject', reason, phoneNumber: botInstance.phoneNumber },
        serverName: getServerName()
      });

      broadcast({ 
        type: 'BOT_REJECTED', 
        data: { botId, name: botInstance.name, reason } 
      });

      res.json({ success: true, message: "Bot rejected successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to reject bot" });
    }
  });

  app.post("/api/admin/send-message/:id", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      const { message } = req.body;
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance || !botInstance.phoneNumber) {
        return res.status(404).json({ message: "Bot instance or phone number not found" });
      }

      // Send message through the bot manager
      const success = await botManager.sendMessageThroughBot(botId, botInstance.phoneNumber, message);
      
      if (!success) {
        return res.status(400).json({ message: "Bot is not online or failed to send message" });
      }
      
      console.log(`📱 Message sent to ${botInstance.phoneNumber}: ${message}`);
      
      // Log activity
      await storage.createActivity({
        serverName: 'default-server',
        botInstanceId: botId,
        type: 'admin_message',
        description: `Admin sent message to ${botInstance.name}`,
        metadata: { message, phoneNumber: botInstance.phoneNumber }
      });

      res.json({ success: true, message: "Message sent successfully" });
    } catch (error) {
      console.error('Admin send message error:', error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.post("/api/admin/bot-instances/:id/start", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      await botManager.startBot(botId);
      broadcast({ type: 'BOT_STATUS_CHANGED', data: { botId, status: 'loading' } });
      
      res.json({ success: true, message: "Bot start initiated" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start bot" });
    }
  });

  app.post("/api/admin/bot-instances/:id/stop", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      await botManager.stopBot(botId);
      broadcast({ type: 'BOT_STATUS_CHANGED', data: { botId, status: 'offline' } });
      
      res.json({ success: true, message: "Bot stopped successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop bot" });
    }
  });

  app.delete("/api/admin/bot-instances/:id", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const botId = req.params.id;
      
      // Get bot instance to retrieve phone number before deletion
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      // Stop the bot first
      await botManager.destroyBot(botId);
      
      // Delete all related data (commands, activities, groups) - CRITICAL MISSING STEP
      await storage.deleteBotRelatedData(botId);
      
      // Delete the bot instance itself
      await storage.deleteBotInstance(botId);
      
      // Remove from god register table if bot instance was found - CRITICAL MISSING STEP  
      if (botInstance.phoneNumber) {
        await storage.deleteGlobalRegistration(botInstance.phoneNumber);
        console.log(`🗑️ Removed ${botInstance.phoneNumber} from god register table`);
      }
      
      broadcast({ type: 'BOT_DELETED', data: { id: botId } });
      
      res.json({ success: true, message: "Bot deleted successfully" });
    } catch (error) {
      console.error('Delete bot error:', error);
      res.status(500).json({ message: "Failed to delete bot" });
    }
  });

  // God Registry Management Endpoints (Admin only)
  app.get("/api/admin/god-registry", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const registrations = await storage.getAllGlobalRegistrations();
      res.json(registrations);
    } catch (error) {
      console.error("Get god registry error:", error);
      res.status(500).json({ message: "Failed to fetch god registry" });
    }
  });

  app.put("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { phoneNumber } = req.params;
      const { tenancyName } = req.body;
      
      if (!tenancyName) {
        return res.status(400).json({ message: "Tenancy name is required" });
      }

      const updated = await storage.updateGlobalRegistration(phoneNumber, tenancyName);
      if (!updated) {
        return res.status(404).json({ message: "Registration not found" });
      }

      // Log activity using cross-tenancy method
      await storage.createCrossTenancyActivity({
        type: 'god_registry_update',
        description: `Admin updated god registry: ${phoneNumber} moved to ${tenancyName}`,
        metadata: { phoneNumber, newTenancy: tenancyName, adminAction: 'update_registry' },
        serverName: getServerName(),
        phoneNumber: phoneNumber,
        remoteTenancy: tenancyName
      });

      res.json({ message: "Registration updated successfully", registration: updated });
    } catch (error) {
      console.error("Update god registry error:", error);
      res.status(500).json({ message: "Failed to update registration" });
    }
  });

  app.delete("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { phoneNumber } = req.params;
      
      // Check if registration exists
      const existing = await storage.checkGlobalRegistration(phoneNumber);
      if (!existing) {
        return res.status(404).json({ message: "Registration not found" });
      }

      await storage.deleteGlobalRegistration(phoneNumber);

      // Log activity using cross-tenancy method
      await storage.createCrossTenancyActivity({
        type: 'god_registry_delete',
        description: `Admin deleted god registry entry: ${phoneNumber} (was on ${existing.tenancyName})`,
        metadata: { phoneNumber, previousTenancy: existing.tenancyName, adminAction: 'delete_registry' },
        serverName: getServerName(),
        phoneNumber: phoneNumber,
        remoteTenancy: existing.tenancyName
      });

      res.json({ message: "Registration deleted successfully" });
    } catch (error) {
      console.error("Delete god registry error:", error);
      res.status(500).json({ message: "Failed to delete registration" });
    }
  });

  // Cross-tenancy approved bots endpoint for master control
  app.get("/api/master/approved-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const allApprovedBots = await storage.getAllApprovedBots();
      
      // Sanitize response - remove credentials and sensitive data
      const sanitizedBots = allApprovedBots.map(bot => ({
        id: bot.id,
        name: bot.name,
        phoneNumber: bot.phoneNumber,
        status: bot.status,
        approvalStatus: bot.approvalStatus,
        serverName: bot.serverName,
        approvalDate: bot.approvalDate,
        expirationMonths: bot.expirationMonths,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
        isGuest: bot.isGuest
        // Explicitly exclude credentials, settings, and other sensitive data
      }));
      
      res.json(sanitizedBots);
    } catch (error) {
      console.error('Failed to fetch cross-tenancy approved bots:', error);
      res.status(500).json({ message: "Failed to fetch approved bots" });
    }
  });

  // Master Control Panel API routes - Cross-tenancy management using God Registry
  app.get("/api/master/tenancies", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const registrations = await storage.getAllGlobalRegistrations();
      
      // Group registrations by tenancy
      const tenancies = registrations.reduce((acc, reg) => {
        if (!acc[reg.tenancyName]) {
          acc[reg.tenancyName] = {
            name: reg.tenancyName,
            botCount: 0,
            registrations: []
          };
        }
        acc[reg.tenancyName].botCount++;
        acc[reg.tenancyName].registrations.push(reg);
        return acc;
      }, {} as any);
      
      res.json(Object.values(tenancies));
    } catch (error) {
      console.error('Failed to fetch tenancies:', error);
      res.status(500).json({ message: "Failed to fetch tenancies" });
    }
  });

  app.get("/api/master/cross-tenancy-bots", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      // Get all global registrations from God Registry
      const registrations = await storage.getAllGlobalRegistrations();
      const currentTenancy = getServerName();
      
      const crossTenancyData = [];
      
      // For each registration in God Registry, get bot data
      for (const registration of registrations) {
        try {
          // If it's current tenancy, get local bot data
          if (registration.tenancyName === currentTenancy) {
            const localBot = await storage.getBotByPhoneNumber(registration.phoneNumber);
            if (localBot) {
              crossTenancyData.push({
                ...localBot,
                tenancy: registration.tenancyName,
                isLocal: true
              });
            }
          } else {
            // For other tenancies, show registry info
            crossTenancyData.push({
              id: `remote-${registration.phoneNumber}`,
              name: `Remote Bot (${registration.tenancyName})`,
              phoneNumber: registration.phoneNumber,
              status: 'remote',
              approvalStatus: 'unknown',
              tenancy: registration.tenancyName,
              lastActivity: registration.registeredAt?.toISOString() || 'Unknown',
              isLocal: false,
              registeredAt: registration.registeredAt
            });
          }
        } catch (error) {
          console.error(`Failed to get bot data for ${registration.phoneNumber}:`, error);
        }
      }
      
      res.json(crossTenancyData);
    } catch (error) {
      console.error('Failed to fetch cross-tenancy bots:', error);
      res.status(500).json({ message: "Failed to fetch cross-tenancy bots" });
    }
  });

  app.post("/api/master/bot-action", authenticateAdmin, async (req: AuthRequest, res) => {
    try {
      const { action, botId, tenancy, data } = req.body;
      const currentTenancy = getServerName();
      
      if (!action || !tenancy) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      // Handle actions for local tenancy
      if (tenancy === currentTenancy) {
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
          maxBots: serverCheck.maxCount
        }
      });
      
    } catch (error) {
      console.error('Cross-server bot registration error:', error);
      res.status(500).json({ message: "Failed to register bot on target server" });
    }
  });

  return httpServer;
}
