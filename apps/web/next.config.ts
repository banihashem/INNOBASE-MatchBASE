import type { NextConfig } from "next";

const qualifiedLiveTestDistDir = process.env.MATCHBASE_TEST_NEXT_DIST_DIR;
if (
  qualifiedLiveTestDistDir !== undefined &&
  (process.env.MATCHBASE_ENVIRONMENT !== "test" ||
    qualifiedLiveTestDistDir !== ".next/qualified-live")
) {
  throw new Error("The isolated Next test build directory is invalid.");
}

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(qualifiedLiveTestDistDir ? { distDir: qualifiedLiveTestDistDir } : {}),
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
