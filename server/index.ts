import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import "./services/enhanced-commands";

// Guard to prevent double-start of monitoring
let monitoringStarted = false;

// Start monitoring once with guard
async function startMonitoringOnce() {
  if (monitoringStarted) return;
  monitoringStarted = true;

  try {
    await startScheduledBotMonitoring();
  } catch (error) {
    console.error('❌ Failed to start monitoring:', error);
  }
}

// Scheduled bot monitoring function
async function startScheduledBotMonitoring() {
  try {
    console.log('🕒 Starting scheduled bot monitoring (every 3 minutes)');

    const { storage } = await import('./storage');
    const { botManager } = await import('./services/bot-manager');

    console.log('✅ Scheduled monitoring imports loaded successfully');

  const checkApprovedBots = async () => {
    try {
      // Get all approved bots (not just autoStart ones)
      const approvedBots = await storage.getApprovedBots();

      if (approvedBots.length === 0) {
        return;
      }

      console.log(`🔍 Monitoring: Checking ${approvedBots.length} approved bot(s)...`);

      for (const bot of approvedBots) {
        try {
          // Check if bot is in the bot manager and its status
          const existingBot = botManager.getBot(bot.id);
          const isOnline = existingBot?.getStatus() === 'online';

          if (!existingBot || !isOnline) {
            console.log(`🔄 Monitoring: Restarting bot ${bot.name} (${bot.id}) - Status: ${existingBot?.getStatus() || 'not found'}`);

            // Create activity log
            await storage.createActivity({
              botInstanceId: bot.id,
              type: 'monitoring',
              description: 'Bot auto-restarted by monitoring - was offline or disconnected',
              serverName: bot.serverName
            });

            // Start the bot
            if (!existingBot) {
              await botManager.createBot(bot.id, bot);
            }
            await botManager.startBot(bot.id);

            console.log(`✅ Monitoring: Bot ${bot.name} restarted successfully`);
          }
        } catch (error) {
          console.error(`❌ Monitoring: Failed to restart bot ${bot.name}:`, error);
          // Log the error as an activity
          await storage.createActivity({
            botInstanceId: bot.id,
            type: 'error',
            description: `Monitoring failed to restart bot: ${error instanceof Error ? error.message : 'Unknown error'}`,
            serverName: bot.serverName
          });
        }
      }
    } catch (error) {
      console.error('❌ Monitoring: Error in checkApprovedBots:', error);
    }
  };

  // Initial check after 10 seconds (faster startup)
  setTimeout(checkApprovedBots, 10000);

  // Schedule checks every 30 seconds (reduced from 3 minutes for faster recovery)
  setInterval(checkApprovedBots, 30000);

  } catch (error) {
    console.error('❌ Failed to start scheduled bot monitoring:', error);
  }
}

const app = express();
app.use(express.json({ limit: '7mb' }));
app.use(express.urlencoded({ extended: false, limit: '7mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Skip logging HEAD requests to /api (health checks) and other non-meaningful requests
    if (path.startsWith("/api") && !(req.method === "HEAD" && path === "/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {

  // Initialize database (create tables if they don't exist)
  await initializeDatabase();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Setup vite for development
  await setupVite(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // Start scheduled bot monitoring in background (non-blocking)
    console.log('🚀 Starting scheduled monitoring system in background...');
    startMonitoringOnce().catch(error => {
      console.error('❌ Failed to start monitoring:', error);
    });
  });

  // Graceful shutdown handling for containerized environments
  const gracefulShutdown = (signal: string) => {
    log(`${signal} received, shutting down gracefully`);
    server.close((err) => {
      if (err) {
        log(`Error during server shutdown: ${err.message}`);
        process.exit(1);
      }
      log('Server closed successfully');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      log('Force shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

})().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});