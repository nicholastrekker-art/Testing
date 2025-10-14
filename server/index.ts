import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import "./services/enhanced-commands";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Guard to prevent double-start of monitoring
let monitoringStarted = false;

// Start monitoring once with guard
async function startMonitoringOnce() {
  if (monitoringStarted) return;
  monitoringStarted = true;

  try {
    console.log('✅ Starting scheduled bot monitoring...');
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

  // Track phone-to-pairing-code mapping for correlating sessions
  const phoneToPairingCode = new Map<string, { code: string; timestamp: number; phoneNumber: string }>();

  // Wrap the sessionStorage Map to auto-save to database when sessions are added
  try {
    const { getSessionStorage } = await import('../pair/lib/index.js');
    const sessionStorage = getSessionStorage();
    const serverName = process.env.SERVER_NAME || process.env.NAME || 'default';
    
    // Store the original set method
    const originalSet = sessionStorage.set.bind(sessionStorage);
    
    // Override the set method to auto-save to database
    sessionStorage.set = function(key: string, value: any) {
      // Call the original set method
      const result = originalSet(key, value);
      
      // Immediately save to database (async, non-blocking)
      (async () => {
        try {
          const { db } = await import('./db');
          const { guestSessions } = await import('../shared/schema');
          const { eq, and } = await import('drizzle-orm');
          
          // Find the most recent pending pairing code entry (within last 5 minutes)
          const pending = await db.select()
            .from(guestSessions)
            .where(
              and(
                eq(guestSessions.sessionId, ''),
                eq(guestSessions.serverName, serverName)
              )
            )
            .orderBy(guestSessions.createdAt, 'desc')
            .limit(1);
          
          if (pending.length > 0 && pending[0].phoneNumber) {
            // Update the most recent pending entry with the session ID
            await db.update(guestSessions)
              .set({ sessionId: key })
              .where(eq(guestSessions.id, pending[0].id));
            
            console.log(`✅ Linked session ID to phone ${pending[0].phoneNumber} with pairing code ${pending[0].pairingCode}: ${key.substring(0, 20)}...`);
            
            // Clean up the tracking map for this phone
            if (pending[0].pairingCode) {
              phoneToPairingCode.delete(pending[0].pairingCode);
            }
          } else {
            // No pending entry found - this shouldn't happen in normal flow
            console.error(`⚠️ Session ${key.substring(0, 20)}... created but no pending pairing code found`);
          }
        } catch (error) {
          console.error('❌ Failed to auto-save session to database:', error);
        }
      })();
      
      return result;
    };
    
    console.log('✅ SessionStorage wrapper installed for auto-save to database');
  } catch (error) {
    console.error('❌ Failed to wrap sessionStorage:', error);
  }
  
  // Integrate pairing API routes from pair/routers/pair.js with rate limiting
  try {
    const pairRouterModule = await import('../pair/routers/pair.js');
    const pairRouter = pairRouterModule.default;
    
    // Simple rate limiting for pairing endpoint (max 5 requests per 15 minutes per IP)
    const pairingRateLimiter = new Map<string, { count: number; resetTime: number }>();
    
    app.use('/api/pairing', (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const limit = 5;
      const windowMs = 15 * 60 * 1000; // 15 minutes
      
      if (!pairingRateLimiter.has(ip)) {
        pairingRateLimiter.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
      }
      
      const record = pairingRateLimiter.get(ip)!;
      
      if (now > record.resetTime) {
        // Reset window
        pairingRateLimiter.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
      }
      
      if (record.count >= limit) {
        return res.status(429).json({ 
          error: 'Too many pairing requests. Please try again later.',
          retryAfter: Math.ceil((record.resetTime - now) / 1000)
        });
      }
      
      record.count++;
      next();
    });
    
    // Middleware to save pairing sessions to database for frontend polling
    app.use('/api/pairing', async (req, res, next) => {
      // Capture the response
      const originalJson = res.json.bind(res);
      res.json = function (data: any) {
        // If pairing code was successfully generated, save to database asynchronously
        if (res.statusCode === 200 && data?.code && req.query.number) {
          (async () => {
            try {
              const { db } = await import('./db');
              const { guestSessions } = await import('../shared/schema');
              const cleanedPhone = String(req.query.number).replace(/[\s\-\(\)\+]/g, '');
              const serverName = process.env.SERVER_NAME || process.env.NAME || 'default';
              
              // Track this pairing code with the phone number for correlation
              phoneToPairingCode.set(data.code, {
                code: data.code,
                phoneNumber: cleanedPhone,
                timestamp: Date.now()
              });
              
              // Clean up old entries (older than 5 minutes)
              for (const [code, entry] of phoneToPairingCode.entries()) {
                if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
                  phoneToPairingCode.delete(code);
                }
              }
              
              // Save session to database for frontend polling
              await db.insert(guestSessions).values({
                phoneNumber: cleanedPhone,
                sessionId: '', // Will be updated when session ID is available
                pairingCode: data.code,
                serverName,
                isUsed: false,
              });
              
              console.log(`✅ Pairing code ${data.code} saved to database and tracked for phone ${cleanedPhone}`);
            } catch (error) {
              console.error('❌ Failed to save pairing code to database:', error);
            }
          })();
        }
        return originalJson(data);
      };
      next();
    });
    
    app.use('/api/pairing', pairRouter);
    log('✅ Pairing API routes integrated successfully with rate limiting');
  } catch (error) {
    console.error('❌ Failed to load pairing routes:', error);
  }

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

    // Delay monitoring startup by 10 seconds to ensure DB is fully ready
    console.log('🚀 Scheduled monitoring system will start in 10 seconds...');
    setTimeout(() => {
      startMonitoringOnce().catch(error => {
        console.error('❌ Failed to start monitoring:', error);
        console.error('Stack trace:', error.stack);
        // Don't crash the server - just log the error
      });
    }, 10000);
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