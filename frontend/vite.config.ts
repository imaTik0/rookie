import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Works under both Deno and Node.
const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env
    .get("ROOKIE_API_URL") ??
    (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
        ?.ROOKIE_API_URL;
const BACKEND_URL = env ?? "http://localhost:3000";

const proxy = {
    "/api": {
        target: BACKEND_URL,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
};

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    server: {
        port: 5173,
        proxy,
    },
    preview: {
        port: 5173,
        proxy,
    },
});
