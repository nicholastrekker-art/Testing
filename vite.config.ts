import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development' || process.env.NODE_ENV === 'development';
  const isProd = mode === 'production' || process.env.NODE_ENV === 'production';
  
  // Configure base path for deployment behind reverse proxies
  // Use root path for production unless BASE_PATH is explicitly set
  const base = isProd ? (process.env.BASE_PATH || '/') : '/';
  
  const plugins = [react()];
  
  // Only load Replit plugins in development environment
  if (isDevelopment) {
    // Runtime error overlay plugin - load only in development
    try {
      // Import the plugin in development only
      const runtimeErrorOverlay = eval(`require("@replit/vite-plugin-runtime-error-modal")`);
      plugins.push(runtimeErrorOverlay.default());
    } catch (e) {
      // Plugin not available or failed to load - continue without it
    }
    
    // Cartographer plugin - load only in development and only if in Replit environment  
    if (process.env.REPL_ID !== undefined) {
      try {
        const cartographerModule = eval(`require("@replit/vite-plugin-cartographer")`);
        plugins.push(cartographerModule.cartographer());
      } catch (e) {
        // Plugin not available or failed to load - continue without it
      }
    }
  }
  
  return {
    base,
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "client", "src"),
        "@shared": path.resolve(process.cwd(), "shared"),
        "@assets": path.resolve(process.cwd(), "attached_assets"),
      },
    },
    root: path.resolve(process.cwd(), "client"),
    build: {
      outDir: path.resolve(process.cwd(), "dist/public"),
      emptyOutDir: true,
    },
    server: {
      host: "0.0.0.0",
      port: 5000,
      allowedHosts: true,
      hmr: isDevelopment ? {
        protocol: 'wss',
        host: 'localhost',
        port: 5000,
      } : undefined,
      fs: {
        strict: false,
        allow: [".."],
      },
    },
  };
});
