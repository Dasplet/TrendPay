/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config) => {
    config.output.chunkLoadTimeout = 300000;
    return config;
  },
};

module.exports = nextConfig;
