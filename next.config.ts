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

  // PWA and Service Worker headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
    ];
  },

  // Webpack configuration for PWA
  webpack: (config, { isServer }) => {
    // Add service worker to client-side build
    if (!isServer) {
      config.output.publicPath = config.output.publicPath.replace(/^\/_next\//, '/_next/');
    }
    return config;
  },
};

export default nextConfig;
