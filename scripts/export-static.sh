#!/bin/bash
# Export static site for deployment
# This script copies the static build to an 'out' directory

set -e

echo "🚀 Exporting static site..."

# Remove existing out directory
if [ -d "out" ]; then
    echo "🗑️  Removing existing out directory..."
    rm -rf out
fi

# Create out directory
mkdir -p out

# Copy static pages
echo "📄 Copying static pages..."
cp -r .next/server/app/* out/

# Copy static assets
echo "📦 Copying static assets..."
mkdir -p out/_next
cp -r .next/static/* out/_next/

# Copy public directory
echo "📁 Copying public directory..."
cp -r public/* out/ 2>/dev/null || true

# Create .nojekyll for GitHub Pages
touch out/.nojekyll

echo "✅ Static export complete!"
echo "📂 Output directory: $(pwd)/out"
echo ""
echo "Deploy to:"
echo "  - Netlify: Drag and drop the 'out' folder"
echo "  - Vercel: Connect repository, set output to 'out'"
echo "  - GitHub Pages: Push to gh-pages branch"
echo "  - Any static host: Upload the 'out' folder contents"
echo ""
echo "For Tauri desktop app:"
echo "  npm run build:tauri"
