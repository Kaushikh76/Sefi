/** @type {import('next').NextConfig} */
const backendOrigin = (process.env.SEFI_BACKEND_INTERNAL_BASE || 'http://127.0.0.1:3210').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
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
