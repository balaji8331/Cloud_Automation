/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "dockerode", "ws"],
  },
  transpilePackages: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
  output: "standalone",
};

export default nextConfig;
