import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the web app.
 *
 * The media and badge tests are pure/SSR-level: no browser globals are needed,
 * so the default `node` environment keeps them fast. `@/` mirrors the
 * tsconfig path alias.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "convex/**/*.test.ts"],
    // The Convex tests own their environment; keep these isolated.
    isolate: true,
  },
});
