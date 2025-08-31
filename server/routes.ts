import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import { storage } from "./storage";
import { insertBotInstanceSchema, insertCommandSchema, insertActivitySchema } from "@shared/schema";
import { botManager } from "./services/bot-manager";

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

  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Bot Instances
  app.get("/api/bot-instances", async (req, res) => {
    try {
      const bots = await storage.getAllBotInstances();
      res.json(bots);
    } catch (error) {
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
        try {
          credentials = JSON.parse(req.file.buffer.toString());
        } catch (error) {
          return res.status(400).json({ message: "Invalid JSON file" });
        }
      }

      const botData = {
        ...req.body,
        credentials,
        autoLike: req.body.autoLike === 'true',
        autoViewStatus: req.body.autoViewStatus === 'true',
        autoReact: req.body.autoReact === 'true',
        chatgptEnabled: req.body.chatgptEnabled === 'true',
      };

      const validatedData = insertBotInstanceSchema.parse(botData);
      const bot = await storage.createBotInstance(validatedData);
      
      // Initialize bot instance
      await botManager.createBot(bot.id, bot);
      
      broadcast({ type: 'BOT_CREATED', data: bot });
      res.json(bot);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create bot instance" });
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

  app.delete("/api/bot-instances/:id", async (req, res) => {
    try {
      await botManager.destroyBot(req.params.id);
      await storage.deleteBotInstance(req.params.id);
      broadcast({ type: 'BOT_DELETED', data: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bot instance" });
    }
  });

  // Bot control endpoints
  app.post("/api/bot-instances/:id/start", async (req, res) => {
    try {
      await botManager.startBot(req.params.id);
      const bot = await storage.updateBotInstance(req.params.id, { status: 'loading' });
      broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to start bot" });
    }
  });

  app.post("/api/bot-instances/:id/stop", async (req, res) => {
    try {
      await botManager.stopBot(req.params.id);
      const bot = await storage.updateBotInstance(req.params.id, { status: 'offline' });
      broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop bot" });
    }
  });

  app.post("/api/bot-instances/:id/restart", async (req, res) => {
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

  return httpServer;
}
