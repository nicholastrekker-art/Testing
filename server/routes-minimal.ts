import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Basic health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is running" });
  });
  
  // Dashboard stats endpoint (placeholder)
  app.get("/api/dashboard/stats", (req, res) => {
    res.json({
      totalBots: 0,
      activeBots: 0,
      messagesCount: 0,
      commandsCount: 0
    });
  });
  
  // Server info endpoint
  app.get("/api/server/info", (req, res) => {
    res.json({
      serverName: process.env.NAME || 'Replit Server',
      maxBots: parseInt(process.env.BOTSCOUNT || '10', 10),
      currentBots: 0,
      availableSlots: parseInt(process.env.BOTSCOUNT || '10', 10)
    });
  });
  
  // Basic root route that serves a simple page
  app.get("/", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Bot Manager</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #333; }
          .status { color: #22c55e; font-weight: bold; }
          .endpoint { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 WhatsApp Bot Manager</h1>
          <p class="status">✅ Server is running successfully!</p>
          <p>Your WhatsApp bot management system has been migrated to Replit and is ready to use.</p>
          
          <h3>Available API Endpoints:</h3>
          <div class="endpoint">GET /api/health - Server health check</div>
          <div class="endpoint">GET /api/dashboard/stats - Dashboard statistics</div>
          <div class="endpoint">GET /api/server/info - Server information</div>
          
          <p><strong>Next Steps:</strong></p>
          <ul>
            <li>The full bot management interface will be available once migration is complete</li>
            <li>Database is connected and ready</li>
            <li>All API endpoints are being restored</li>
          </ul>
        </div>
      </body>
      </html>
    `);
  });
  
  return httpServer;
}