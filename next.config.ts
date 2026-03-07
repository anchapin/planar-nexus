import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Note: Removed 'output: export' because Server Actions are not compatible
  // with static exports. The app uses a custom service worker (public/sw.js)
  // for PWA/offline functionality instead.
  // Using default Next.js output mode (dynamic) to support Server Actions.
  
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
  
  // TypeScript and ESLint settings
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  // Set base path for deployment
  basePath: '',
};

export default nextConfig;
