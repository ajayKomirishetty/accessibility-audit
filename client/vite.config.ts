import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API calls are proxied to the backend in dev so the frontend can use
// relative "/api/..." URLs with no CORS issues.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
