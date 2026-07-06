/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
    instrumentationHook: true,
  },
};

export default nextConfig;
