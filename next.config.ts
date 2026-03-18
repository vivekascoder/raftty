import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PORT ? `.next-${process.env.PORT}` : '.next',
};

export default nextConfig;
