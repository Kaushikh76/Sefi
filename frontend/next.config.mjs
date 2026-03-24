/** @type {import('next').NextConfig} */
const backendOrigin = (process.env.SEFI_BACKEND_INTERNAL_BASE || 'http://127.0.0.1:3210').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Converse/agent requests can run longer than Next's dev proxy default (30s).
    // Raise proxy timeout so `/api/v1/*` rewrites don't terminate long backend calls.
    proxyTimeout: 180000,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
