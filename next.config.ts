import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Enable static export for Tauri/PWA compatibility
  output: 'export',
  
  // Configure image optimization for static export
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
  
  // Disable SSR features not compatible with static export
  // Note: The following features are not compatible with output: 'export':
  // - API routes
  // - rewrites to dynamic routes
  // - redirects (unless using static external URLs)
  
  // Set base path for deployment
  basePath: '',
  
  // Generate static HTML files
  // This is required for proper SPA behavior
};

export default nextConfig;
