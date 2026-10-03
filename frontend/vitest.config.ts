import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

/**
 * Vitest configuration.
 *
 * No `@vitejs/plugin-react`: JSX is compiled by esbuild using the `jsx` setting
 * from tsconfig.json, so the plugin is unnecessary. Omitting it also avoids a
 * type conflict between the root `vite` (rolldown-based) and the `vite` bundled
 * inside vitest.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Component tests share one jsdom document; extra forks cost more than they
    // save here and make clipboard/observer mocks flaky.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.d.ts", "node_modules/**", ".next/**", "e2e/**"],
      thresholds: {
        // Honest floor for current coverage; raise as screens gain tests.
        statements: 40,
        branches: 30,
        functions: 30,
        lines: 40,
      },
    },
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});