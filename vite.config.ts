import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development' || process.env.NODE_ENV === 'development';
  
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
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      host: "0.0.0.0",
      port: 5000,
      allowedHosts: true,
      hmr: {
        port: 5000,
        host: "0.0.0.0",
      },
      fs: {
        strict: false,
        allow: [".."],
      },
    },
  };
});
