import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ts-ignore
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
