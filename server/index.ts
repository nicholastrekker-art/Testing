import express, { type Request, Response, NextFunction } from "express";
import path from "path";
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
    // Verify database connection before starting monitoring
    const { storage } = await import('./storage');
    await storage.initializeCurrentServer();
    console.log('✅ Database connection verified');
    
    await startScheduledBotMonitoring();
  } catch (error) {
    console.error('❌ Failed to start monitoring:', error);
    console.error('Error details:', error);
    // Reset flag so monitoring can be retried
    monitoringStarted = false;
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
      // Get ALL approved bots for this server - includes existing and newly approved bots
      const approvedBots = await storage.getApprovedBots();

      if (!approvedBots || approvedBots.length === 0) {
        console.log('ℹ️ No approved bots found to monitor');
        return;
      }

      console.log(`🔍 Monitoring: Checking ${approvedBots.length} approved bot(s) - ALL approved bots will be auto-started...`);

      for (const bot of approvedBots) {
        try {
          // Check if bot is in the bot manager and its status
          const existingBot = botManager.getBot(bot.id);
          const isOnline = existingBot?.getStatus() === 'online';

          // Auto-start ALL approved bots that are not online (including newly approved ones)
          if (!existingBot || !isOnline) {
            console.log(`🔄 Monitoring: Auto-starting approved bot ${bot.name} (${bot.id}) - Status: ${existingBot?.getStatus() || 'not found'}`);
            await botManager.startBot(bot.id);
            // Note: Success message is logged inside startBot if successful
          } else {
            console.log(`   ✓ Bot ${bot.name} already online`);
          }
        } catch (error) {
          // Log but continue - one bot failure should not stop monitoring
          console.error(`❌ Monitoring: Failed to auto-start bot ${bot.id}:`, error);
          console.log(`✅ Monitoring continues despite bot failure`);
        }
      }
    } catch (error) {
      // Log but don't crash - monitoring should be resilient
      console.error('❌ Monitoring check failed:', error);
      console.log(`✅ Server continues running despite monitoring error`);
    }
  };

  // Initial check after 10 seconds (faster startup)
  setTimeout(checkApprovedBots, 10000);

  // Schedule checks every 30 seconds (reduced from 3 minutes for faster recovery)
  setInterval(checkApprovedBots, 30000);

    // Server heartbeat - update lastActive every 30 minutes
    const updateServerHeartbeat = async () => {
      try {
        await storage.updateServerHeartbeat();
        console.log('💓 Server heartbeat updated');
      } catch (error) {
        console.error('❌ Failed to update server heartbeat:', error);
      }
    };

    // Initial heartbeat update after 1 minute
    setTimeout(updateServerHeartbeat, 60000);

    // Schedule heartbeat updates every 30 minutes (1800000ms)
    setInterval(updateServerHeartbeat, 1800000);

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

  // Serve pairing interface files directly from pair/public
  app.use('/pair', express.static(path.join(__dirname, '../pair/public')));

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

    // Delay monitoring startup by 5 seconds to ensure DB is fully ready
    console.log('🚀 Scheduled monitoring system will start in 5 seconds...');
    setTimeout(() => {
      startMonitoringOnce().catch(error => {
        console.error('❌ Failed to start monitoring:', error);
        console.error('Stack trace:', error.stack);
        // Don't crash the server - just log the error
      });
    }, 5000);
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