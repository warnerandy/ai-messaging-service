import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig(({ command }) => {
  const isDev = command === "serve"

  return {
    plugins: [react(), tailwindcss()],
    root: path.resolve(__dirname),
    publicDir: false,
    build: {
      outDir: path.resolve(__dirname, "../priv/static/assets"),
      emptyOutDir: false,
      manifest: true,
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, "js/app.jsx"),
        },
        output: {
          entryFileNames: "js/app.js",
          chunkFileNames: "js/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith(".css")) {
              return "css/app.css"
            }
            return "assets/[name]-[hash][extname]"
          },
        },
      },
    },
    resolve: {
      alias: {
        phoenix: path.resolve(__dirname, "../deps/phoenix/priv/static/phoenix.mjs"),
      },
    },
    server: {
      origin: "http://localhost:5173",
      proxy: {
        "/api": "http://localhost:4000",
        "/socket": {
          target: "http://localhost:4000",
          ws: true,
        },
        "/bot": {
          target: "http://localhost:4000",
          ws: true,
        },
      },
    },
  }
})
