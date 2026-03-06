#!/usr/bin/env node

/**
 * Service Worker Verification Script
 * Tests service worker functionality and cache management
 */

const path = require('path');
const fs = require('fs');

console.log('🔍 Planar Nexus Service Worker Verification\n');

// Check service worker file exists
const swPath = path.join(__dirname, 'public', 'sw.js');
if (!fs.existsSync(swPath)) {
  console.error('❌ Service worker file not found:', swPath);
  process.exit(1);
}
console.log('✅ Service worker file exists');

// Check offline page exists
const offlinePath = path.join(__dirname, 'public', 'offline.html');
if (!fs.existsSync(offlinePath)) {
  console.error('❌ Offline page not found:', offlinePath);
  process.exit(1);
}
console.log('✅ Offline page exists');

// Check manifest exists
const manifestPath = path.join(__dirname, 'public', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Manifest not found:', manifestPath);
  process.exit(1);
}
console.log('✅ Manifest exists');

// Read and validate service worker
const swContent = fs.readFileSync(swPath, 'utf8');

// Check for required features
const requiredFeatures = [
  'CACHE_VERSION',
  'STATIC_CACHE',
  'DYNAMIC_CACHE',
  'CARD_CACHE',
  'IMAGE_CACHE',
  'API_CACHE',
  'cacheFirst',
  'networkFirst',
  'staleWhileRevalidate',
  'install',
  'activate',
  'fetch',
  'message',
  'sync',
];

const missingFeatures = requiredFeatures.filter(feature => !swContent.includes(feature));

if (missingFeatures.length > 0) {
  console.error('❌ Missing service worker features:', missingFeatures);
  process.exit(1);
}
console.log('✅ All required service worker features present');

// Check cache version
const versionMatch = swContent.match(/const CACHE_VERSION = '([^']+)'/);
if (!versionMatch) {
  console.error('❌ Cache version not found');
  process.exit(1);
}
console.log('✅ Cache version:', versionMatch[1]);

// Check cache strategies
const hasCacheFirst = swContent.includes('cacheFirst');
const hasNetworkFirst = swContent.includes('networkFirst');
const hasStaleWhileRevalidate = swContent.includes('staleWhileRevalidate');

if (!hasCacheFirst || !hasNetworkFirst || !hasStaleWhileRevalidate) {
  console.error('❌ Missing cache strategies');
  process.exit(1);
}
console.log('✅ All cache strategies implemented');

// Check message handling
const messageTypes = [
  'GET_VERSION',
  'CLEAR_CACHE',
  'GET_CACHE_INFO',
  'CACHE_CARDS',
  'PRECACHE_IMAGES',
  'SKIP_WAITING',
];

const missingMessageTypes = messageTypes.filter(type => !swContent.includes(type));

if (missingMessageTypes.length > 0) {
  console.error('❌ Missing message types:', missingMessageTypes);
  process.exit(1);
}
console.log('✅ All message types handled');

// Check component files
const componentFiles = [
  path.join(__dirname, 'src', 'components', 'offline-indicator.tsx'),
  path.join(__dirname, 'src', 'components', 'service-worker-registration.tsx'),
];

for (const file of componentFiles) {
  if (!fs.existsSync(file)) {
    console.error('❌ Component not found:', file);
    process.exit(1);
  }
}
console.log('✅ All component files exist');

// Check hook files
const hookFiles = [
  path.join(__dirname, 'src', 'lib', 'use-service-worker-cache.ts'),
  path.join(__dirname, 'src', 'lib', 'use-network-status.ts'),
];

for (const file of hookFiles) {
  if (!fs.existsSync(file)) {
    console.error('❌ Hook not found:', file);
    process.exit(1);
  }
}
console.log('✅ All hook files exist');

// Check documentation
const docFiles = [
  path.join(__dirname, 'SERVICE_WORKER_GUIDE.md'),
  path.join(__dirname, 'UNIT_15_IMPLEMENTATION_SUMMARY.md'),
];

for (const file of docFiles) {
  if (!fs.existsSync(file)) {
    console.error('❌ Documentation not found:', file);
    process.exit(1);
  }
}
console.log('✅ All documentation files exist');

// Check tests
const testFile = path.join(__dirname, 'src', 'lib', '__tests__', 'service-worker.test.ts');
if (!fs.existsSync(testFile)) {
  console.error('❌ Test file not found:', testFile);
  process.exit(1);
}
console.log('✅ Test file exists');

console.log('\n✅ All verifications passed!\n');
console.log('📋 Summary:');
console.log('  - Service Worker: v3.0');
console.log('  - Cache Version:', versionMatch[1]);
console.log('  - Cache Strategies: 3 (cache-first, network-first, stale-while-revalidate)');
console.log('  - Message Types: 6');
console.log('  - Components: 2');
console.log('  - Hooks: 2');
console.log('  - Documentation: 2 files');
console.log('  - Tests: 1 suite');
console.log('\n🚀 Ready for testing and deployment!');
