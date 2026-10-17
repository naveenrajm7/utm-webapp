const isDemo = process.env.NEXT_PUBLIC_DEMO === "1";

/** @type {import("next").NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["@repo/ui"],
  ...(isDemo
    ? {
        // GitHub Pages serves static files from /<repository>/.
        output: "export",
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};
