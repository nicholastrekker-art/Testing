import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import "./services/enhanced-commands";
import WebSocket, { WebSocketServer } from 'ws';

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

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
      log('🔍 Checking approved bots status...');

      // Get all approved bots that should be auto-started
      const approvedBots = await storage.getBotInstancesForAutoStart();

      if (approvedBots.length === 0) {
        log('📋 No approved bots found for monitoring');
        return;
      }

      log(`📊 Found ${approvedBots.length} approved bot(s) to monitor`);

      for (const bot of approvedBots) {
        try {
          // Check if bot is in the bot manager and its status
          const existingBot = botManager.getBot(bot.id);
          const isOnline = existingBot?.getStatus() === 'online';

          if (!existingBot || !isOnline) {
            log(`🚀 Starting/restarting approved bot: ${bot.name} (${bot.id})`);

            // Create activity log
            await storage.createActivity({
              botInstanceId: bot.id,
              type: 'monitoring',
              description: 'Bot restarted by scheduled monitoring - was offline or not found',
              serverName: bot.serverName
            });

            // Start the bot
            if (!existingBot) {
              await botManager.createBot(bot.id, bot);
            }
            await botManager.startBot(bot.id);

            log(`✅ Scheduled restart completed for bot: ${bot.name}`);
          } else {
            log(`✓ Bot ${bot.name} is already online`);
          }
        } catch (error) {
          log(`❌ Failed to restart bot ${bot.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);

          // Log the error as an activity
          await storage.createActivity({
            botInstanceId: bot.id,
            type: 'error',
            description: `Scheduled monitoring failed to restart bot: ${error instanceof Error ? error.message : 'Unknown error'}`,
            serverName: bot.serverName
          });
        }
      }

      log('✅ Scheduled bot monitoring check completed');
    } catch (error) {
      log(`❌ Scheduled bot monitoring error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Initial check after 30 seconds
  setTimeout(checkApprovedBots, 30000);

  // Schedule checks every 3 minutes (180,000 milliseconds)
  setInterval(checkApprovedBots, 180000);

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

  // Start scheduled bot monitoring immediately after database initialization
  console.log('🚀 Bootstrap: Starting scheduled monitoring system...');
  await startMonitoringOnce();

  const server = await registerRoutes(app);

  // WebSocket handling with duplicate prevention
  const handledSockets = new WeakSet();
  
  server.on('upgrade', (request, socket, head) => {
    // Prevent duplicate handling of the same socket
    if (handledSockets.has(socket)) {
      console.log('⚠️ WebSocket upgrade already handled for this socket, skipping...');
      return;
    }
    
    handledSockets.add(socket);
    
    console.log('🔌 WebSocket upgrade request received:', {
      url: request.url,
      headers: {
        origin: request.headers.origin,
        userAgent: request.headers['user-agent'],
        connection: request.headers.connection,
        upgrade: request.headers.upgrade
      },
      remoteAddress: request.socket.remoteAddress,
      timestamp: new Date().toISOString()
    });

    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('✅ WebSocket upgrade successful');
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    const clientId = Math.random().toString(36).substr(2, 9);
    console.log(`🟢 Client connected to WebSocket [${clientId}]`, {
      clientId,
      remoteAddress: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
      timestamp: new Date().toISOString(),
      totalConnections: wss.clients.size
    });

    // Handle ping messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          console.log(`💓 Heartbeat ping received from [${clientId}]`);
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.warn(`❌ Invalid message from [${clientId}]:`, data.toString());
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`🔴 Client disconnected from WebSocket [${clientId}]`, {
        clientId,
        code,
        reason: reason.toString(),
        timestamp: new Date().toISOString(),
        totalConnections: wss.clients.size - 1
      });
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for [${clientId}]:`, {
        clientId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    });

    // Monitor connection health
    const healthCheck = setInterval(() => {
      if (ws.readyState === ws.CONNECTING) {
        console.warn(`⚠️ Client [${clientId}] still connecting after extended time`);
      } else if (ws.readyState === ws.CLOSING) {
        console.warn(`⚠️ Client [${clientId}] taking long to close`);
      } else if (ws.readyState === ws.CLOSED) {
        console.log(`🔴 Client [${clientId}] connection is now closed`);
        clearInterval(healthCheck);
      }
    }, 10000);

    ws.on('close', () => {
      clearInterval(healthCheck);
    });
  });

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