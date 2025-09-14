import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { type Server } from "http";
import { nanoid } from "nanoid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // In production, serve static files instead of using vite middleware
  if (process.env.NODE_ENV === 'production') {
    log("Setting up production static file serving");
    return serveStatic(app);
  }

  log("Setting up development vite middleware");
  
  // Dynamic imports to avoid loading vite in production
  const { createServer: createViteServer, createLogger } = await import("vite");
  const userCfgExport = (await import("../vite.config")).default;
  
  // Resolve the config function to get the actual configuration
  const userCfg = typeof userCfgExport === "function"
    ? userCfgExport({ mode: process.env.NODE_ENV === "production" ? "production" : "development", command: "serve" })
    : userCfgExport;
  
  const viteLogger = createLogger();
  
  const vite = await createViteServer({
    ...userCfg,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: {
      ...userCfg.server,
      middlewareMode: true,
      hmr: { 
        server,
        host: "0.0.0.0",
        clientPort: 5000 
      },
      host: "0.0.0.0",
      allowedHosts: true,
      cors: true,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  // Only serve HTML for non-API routes to prevent API endpoints from returning HTML
  app.get("*", async (req, res, next) => {
    const url = req.originalUrl;
    
    // Skip API routes - let them be handled by the registered API routes
    if (url.startsWith('/api/') || url.startsWith('/ws')) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Support deployment behind reverse proxies with path prefixes
  const base = process.env.BASE_PATH || '/';
  const basePath = base === '/' ? base : base.replace(/\/$/, ''); // Remove trailing slash except for root

  log(`Serving static files at base path: ${basePath}`);

  // Serve static assets under the base path
  app.use(basePath, express.static(distPath));

  // Handle SPA routing - serve index.html for non-API routes under base path
  const indexPath = path.resolve(distPath, "index.html");
  
  if (basePath === '/') {
    // Root deployment - catch all non-API routes
    app.use("*", (req, res, next) => {
      // Skip API routes - let them be handled by the registered API routes
      if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/ws')) {
        return next();
      }
      res.sendFile(indexPath);
    });
  } else {
    // Path-based deployment - catch routes under base path
    app.get([basePath, `${basePath}/*`], (req, res, next) => {
      // Skip API routes - let them be handled by the registered API routes  
      if (req.originalUrl.startsWith(`${basePath}/api/`) || req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/ws')) {
        return next();
      }
      res.sendFile(indexPath);
    });
    
    // Also handle root-level API routes for compatibility
    app.use("*", (req, res, next) => {
      if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/ws')) {
        return next();
      }
      // For non-API routes not under base path, redirect to base path
      if (!req.originalUrl.startsWith(basePath)) {
        return res.redirect(basePath);
      }
      next();
    });
  }
}
