import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not emit AGENTS.md/CLAUDE.md into the repo.
  agentRules: false,
  turbopack: {
    // This app lives inside a larger repo that has its own lockfile. Pin the
    // workspace root so Turbopack does not infer the parent and warn on every run.
    root: path.join(__dirname),
  },
};

export default nextConfig;
