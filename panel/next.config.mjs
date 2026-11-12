/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Docker builds with NEXT_STANDALONE=1 to get .next/standalone; local `next start`
  // keeps working otherwise (Next refuses to start a standalone build from .next).
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
