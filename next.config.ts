import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
