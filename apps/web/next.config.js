/** @type {import('next').NextConfig} */
// Identificador de esta versión publicada: cambia en cada despliegue. Las pantallas abiertas lo comparan con el del servidor
// (/version) para actualizarse solas cuando sale una versión nueva.
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || String(Date.now());

const nextConfig = {
  reactStrictMode: false,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  webpack: (config) => {
    config.output.chunkLoadTimeout = 300000;
    return config;
  },
};

module.exports = nextConfig;
