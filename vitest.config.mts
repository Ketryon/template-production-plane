import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// .mts, not .ts: this file uses ESM syntax and package.json has no
// "type": "module", so Vite's native config loader warns about loading it as
// CommonJS. The extension settles it rather than suppressing the warning.
//
// Node environment: everything worth testing here is pure logic or a server
// module. The UI is per-plane and deliberately not templated.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
