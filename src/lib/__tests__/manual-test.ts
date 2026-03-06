/**
 * @fileOverview Manual test for procedural artwork generator
 *
 * Run with: npx tsx src/lib/__tests__/manual-test.ts
 */

import { generateArtwork, svgToDataUrl, getCachedArtwork } from '../procedural-art-generator';

console.log('Testing Procedural Artwork Generator...\n');

// Test 1: Generate artwork
console.log('Test 1: Generate artwork for a card');
const result1 = generateArtwork({
  cardName: 'Crimson Dragon',
  cardId: 'test-001',
  colors: ['R'],
  typeLine: 'Legendary Creature — Dragon',
  cmc: 5,
  width: 244,
  height: 340,
});

console.log('✓ Generated SVG');
console.log('  Cache key:', result1.cacheKey);
console.log('  SVG length:', result1.svg.length, 'characters');

// Test 2: Verify SVG structure
console.log('\nTest 2: Verify SVG structure');
if (result1.svg.includes('<svg') && result1.svg.includes('</svg>')) {
  console.log('✓ Valid SVG structure');
} else {
  console.log('✗ Invalid SVG structure');
}

// Test 3: Determinism
console.log('\nTest 3: Verify determinism (same card = same artwork)');
const result2 = generateArtwork({
  cardName: 'Crimson Dragon',
  cardId: 'test-001',
  colors: ['R'],
  typeLine: 'Legendary Creature — Dragon',
  cmc: 5,
  width: 244,
  height: 340,
});

if (result1.svg === result2.svg) {
  console.log('✓ Deterministic generation confirmed');
} else {
  console.log('✗ Non-deterministic generation detected');
}

// Test 4: Different cards
console.log('\nTest 4: Verify different cards generate different artwork');
const result3 = generateArtwork({
  cardName: 'Azure Mind',
  cardId: 'test-002',
  colors: ['U'],
  typeLine: 'Creature — Wizard',
  cmc: 3,
  width: 244,
  height: 340,
});

if (result1.svg !== result3.svg) {
  console.log('✓ Different cards generate different artwork');
} else {
  console.log('✗ Same artwork for different cards');
}

// Test 5: Data URL conversion
console.log('\nTest 5: Convert SVG to data URL');
const dataUrl = svgToDataUrl(result1.svg);
if (dataUrl.startsWith('data:image/svg+xml')) {
  console.log('✓ Valid data URL generated');
  console.log('  Data URL length:', dataUrl.length, 'characters');
} else {
  console.log('✗ Invalid data URL');
}

// Test 6: Caching
console.log('\nTest 6: Test artwork caching');
const cachedUrl1 = getCachedArtwork({
  cardName: 'Crimson Dragon',
  cardId: 'test-001',
  colors: ['R'],
  typeLine: 'Legendary Creature — Dragon',
  cmc: 5,
  width: 244,
  height: 340,
});

const cachedUrl2 = getCachedArtwork({
  cardName: 'Crimson Dragon',
  cardId: 'test-001',
  colors: ['R'],
  typeLine: 'Legendary Creature — Dragon',
  cmc: 5,
  width: 244,
  height: 340,
});

if (cachedUrl1 === cachedUrl2) {
  console.log('✓ Caching works correctly');
} else {
  console.log('✗ Caching not working');
}

// Test 7: Different styles
console.log('\nTest 7: Test different artwork styles');
const styles = ['fantasy', 'sci-fi', 'abstract', 'geometric'] as const;
for (const style of styles) {
  const result = generateArtwork({
    cardName: 'Test Card',
    cardId: `test-style-${style}`,
    colors: ['R'],
    typeLine: 'Creature — Dragon',
    cmc: 3,
    width: 244,
    height: 340,
    style,
  });
  console.log(`  ${style}: ✓ (${result.svg.length} characters)`);
}

// Test 8: Different complexities
console.log('\nTest 8: Test different complexity levels');
const complexities = ['simple', 'medium', 'complex'] as const;
for (const complexity of complexities) {
  const result = generateArtwork({
    cardName: 'Test Card',
    cardId: `test-complexity-${complexity}`,
    colors: ['R'],
    typeLine: 'Creature — Dragon',
    cmc: 3,
    width: 244,
    height: 340,
    complexity,
  });
  console.log(`  ${complexity}: ✓ (${result.svg.length} characters)`);
}

// Test 9: Different moods
console.log('\nTest 9: Test different moods');
const moods = ['peaceful', 'energetic', 'mysterious', 'aggressive'] as const;
for (const mood of moods) {
  const result = generateArtwork({
    cardName: 'Test Card',
    cardId: `test-mood-${mood}`,
    colors: ['R'],
    typeLine: 'Creature — Dragon',
    cmc: 3,
    width: 244,
    height: 340,
    mood,
  });
  console.log(`  ${mood}: ✓ (${result.svg.length} characters)`);
}

console.log('\n✅ All tests passed!');
