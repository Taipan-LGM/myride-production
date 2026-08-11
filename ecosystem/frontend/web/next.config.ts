import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API base URL configuration
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8001",
  },
  // Enable strict mode for better error handling
  reactStrictMode: true,
  // Images remote patterns (replaces deprecated domains)
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3000',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8001',
      },
    ],
  },
};

export default nextConfig;