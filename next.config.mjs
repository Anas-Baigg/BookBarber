/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        'bookbarber.app',
        'www.bookbarber.app',
      ],
    },
  },
};

export default nextConfig;
