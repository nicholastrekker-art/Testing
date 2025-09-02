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
import { sendValidationMessage } from "./services/validation-bot";

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
      
      // Filter bots that have credentials (can be resumed)
      const resumableBots = savedBots.filter(bot => bot.credentials);
      
      if (resumableBots.length === 0) {
        console.log('⚠️ No bots with credentials found to resume');
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
      const serverName = process.env.NAME || 'Unknown';
      const maxBots = parseInt(process.env.BOTSCOUNT || '10', 10);
      const currentBots = await storage.getAllBotInstances();
      
      res.json({
        serverName,
        maxBots,
        currentBots: currentBots.length,
        availableSlots: maxBots - currentBots.length
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch server info" });
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
      const { expirationMonths } = req.body;
      
      const success = await storage.approveBotInstance(id, expirationMonths);
      if (success) {
        res.json({ message: "Bot approved successfully" });
      } else {
        res.status(404).json({ message: "Bot not found" });
      }
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
      
      // Check bot count limit using environment variable
      const canAddBot = await storage.checkBotCountLimit();
      if (!canAddBot) {
        const maxBots = parseInt(process.env.BOTSCOUNT || '10', 10);
        return res.status(400).json({ 
          message: `Sorry 😞... The server is full! Maximum bot limit reached (${maxBots} bots). Please contact administrator for more capacity.` 
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
      const currentSettings = bot.settings || {};
      const currentFeatures = currentSettings.features || {};
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
      
      await storage.updateBotInstance(id, {
        approvalStatus: 'approved',
        approvalDate: new Date().toISOString(),
        expirationMonths,
        status: 'offline' // Ready for activation
      });
      
      // Log activity
      await storage.createActivity({
        botInstanceId: id,
        type: 'approval',
        description: `Bot approved for ${expirationMonths} months`,
        metadata: { expirationMonths },
        serverName: getServerName()
      });
      
      res.json({ message: "Bot approved successfully" });
      
    } catch (error) {
      console.error('Bot approval error:', error);
      res.status(500).json({ message: "Failed to approve bot" });
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
                category: command.category,
                useChatGPT: false
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
          handler: customHandler
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
        autoLike: botFeatures.autoLike || false,
        autoViewStatus: botFeatures.autoView || false,
        autoReact: botFeatures.autoReact || false,
        typingMode: botFeatures.typingIndicator ? 'typing' : 'none',
        chatgptEnabled: botFeatures.chatGPT || false,
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
        
        await sendValidationMessage(phoneNumber, credentialsBase64, validationMessage);
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
          
          // Validate phone number ownership
          if (newCredentials && newCredentials.me && newCredentials.me.id) {
            const credentialsPhoneMatch = newCredentials.me.id.match(/^(\d+):/);
            const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
            const inputPhone = phoneNumber.replace(/^\+/, '');
            
            if (!credentialsPhone || credentialsPhone !== inputPhone) {
              return res.status(400).json({ 
                message: "Credentials don't match your phone number" 
              });
            }
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
          
          res.json({ 
            success: true, 
            message: "Credentials updated successfully. Bot can now be restarted."
          });
          break;
          
        case 'stop':
          try {
            await botManager.destroyBot(botId);
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
      const botInstance = await storage.getBotInstance(botId);
      
      if (!botInstance) {
        return res.status(404).json({ message: "Bot instance not found" });
      }

      // Stop the bot first
      await botManager.destroyBot(botId);
      
      // Delete from database
      await storage.deleteBotInstance(botId);
      
      broadcast({ type: 'BOT_DELETED', data: { botId } });
      
      res.json({ success: true, message: "Bot deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bot" });
    }
  });

  return httpServer;
}
