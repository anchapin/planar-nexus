import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Static export for client-side only deployment
  // Now that all Server Actions have been removed, we can use static export
  output: 'export',

  // Configure image optimization
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cards.scryfall.io',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.scryfall.com',
        port: '',
        pathname: '/**',
      },
    ],
  },

  // Ensure trailing slashes for static hosting
  trailingSlash: true,

  // Set base path for deployment
  basePath: '',
};

export default nextConfig;
