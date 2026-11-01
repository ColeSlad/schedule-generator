import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "web",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8011",
        rewrite: (p) => p.replace(/^\/api/, ""),
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (
              "writeHead" in response &&
              !response.headersSent &&
              !response.writableEnded
            ) {
              response.writeHead(503, { "Content-Type": "application/json" });
              response.end(
                JSON.stringify({
                  detail:
                    "The planning backend is unavailable. Restart npm run dev to start both services.",
                }),
              );
            }
          });
        },
      },
    },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
