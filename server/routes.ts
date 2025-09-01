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
import { authenticateAdmin, authenticateUser, validateAdminCredentials, generateToken, type AuthRequest } from './middleware/auth';

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
  app.post("/api/validate-credentials", upload.single('credentials'), async (req, res) => {
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

  // Bot Instances
  app.get("/api/bot-instances", async (req, res) => {
    try {
      const bots = await storage.getAllBotInstances();
      res.json(bots);
    } catch (error) {
      console.error("Bot instances error:", error);
      res.status(500).json({ message: "Failed to fetch bot instances" });
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

  app.post("/api/bot-instances", upload.single('credentials'), async (req, res) => {
    try {
      let credentials = null;
      
      if (req.file) {
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
      
      // Check bot count limit (max 10 bots for regular users)
      if (existingBots.length >= 10) {
        return res.status(400).json({ 
          message: `Maximum bot limit reached (10 bots). Please delete existing bots before adding new ones.` 
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
                description: `Bot "${bot.name}" was automatically deleted due to connection failure`
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
        description: `🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot "${bot.name}" created successfully!`
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
      await botManager.destroyBot(req.params.id);
      await storage.deleteBotInstance(req.params.id);
      broadcast({ type: 'BOT_DELETED', data: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bot instance" });
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
      const commands = await storage.getCommands(botInstanceId);
      res.json(commands);
    } catch (error) {
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
