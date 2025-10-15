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
  app.use(async (req, res, next) => {
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
  const distPath = path.resolve(process.cwd(), "dist/public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets with proper cache headers
  app.use(express.static(distPath, {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // Set proper cache headers for assets
      if (filePath.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // Serve index.html for all non-API routes (SPA fallback)
  app.use((req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"), (err) => {
      if (err) {
        next(err);
      }
    });
  });
}