import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Keep native Node modules out of Turbopack bundling (they use binary addons / C++ bindings)
  serverExternalPackages: ['ioredis', 'bullmq'],
  typescript: {
    // Type safety is enforced by `pnpm typecheck` (CI) instead of the build so
    // VPS deploys can't be blocked by type noise outside the app. Note the
    // generated `.next/types` page-props assertions only exist after a build;
    // src/__tests__/next16-app-router-params.test.ts guards that contract.
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // Aggressive caching for RA game assets (immutable PNGs + JSON)
        source: '/ra/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Hero demo videos (immutable, 1yr cache)
        source: '/demo/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
