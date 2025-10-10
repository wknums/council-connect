import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, PluginOption } from "vite";

import sparkPlugin from "@github/spark/spark-vite-plugin";
import createIconImportProxy from "@github/spark/vitePhosphorIconProxyPlugin";
import { resolve } from 'path'

const localSparkHealthcheck = (): PluginOption => ({
  name: "spark-healthcheck-dev-mock",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/_spark/loaded") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      next();
    });
  },
});

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // DO NOT REMOVE
    createIconImportProxy() as PluginOption,
    sparkPlugin() as PluginOption,
    localSparkHealthcheck(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        // Azure Functions local host sometimes redirects; ensure websockets disabled for plain HTTP
        ws: false,
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
});
