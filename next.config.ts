import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal standalone server (.next/standalone) with only the
  // files needed at runtime - the smallest, most portable way to run this
  // behind `node server.js` in a container on any persistent-process host.
  output: "standalone",
};

export default nextConfig;
