import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ignore vendored / third-party code
    "src/EasterEgg/**",
    "public/ra/**",
    // Build outputs
    "cli/dist/**",
    "packages/*/dist/**",
    // Generated artifacts, exports, and standalone demos — not part of the product build
    "artifacts/**",
    "exports/**",
    "test-results/**",
    "submission/**",
    "Game Demo/**",
  ]),
  {
    // One-off RA-parity debug probes and asset tooling. WASM/runtime
    // introspection there is untyped by nature; `module` is a harmless
    // variable name outside the webpack bundle.
    files: ["scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    // Tests: `any` and lazy require() are accepted idioms for mocks/fixtures.
    files: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // react-hooks v6 flags the Next.js hydration idiom (sync state from
    // localStorage/cookies/matchMedia after mount). Keep it visible as a
    // warning; migrate call sites deliberately, not mechanically.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
