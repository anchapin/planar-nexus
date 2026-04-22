# Card Database Import Guide

## Overview

Planar Nexus starts with an **empty card database** to avoid legal issues. Users must import their own card data for personal use.

## Quick Start

### Option 1: Automated Fetch (Recommended)

1. **Run the fetch script:**

```bash
npx tsx scripts/fetch-cards-for-db.ts --format=commander --limit=500 --output=./my-cards.json
```

2. **Open Planar Nexus** in your browser

3. **Go to Settings → Database Management**

4. **Click "Select JSON File"** and choose `my-cards.json`

5. **Wait for import** (typically 5-10 seconds for 500 cards)

### Option 2: Manual JSON Import

If you have card data from another source, create a JSON file with this format:

```json
[
  {
    "id": "unique-card-id",
    "name": "Card Name",
    "cmc": 3,
    "type_line": "Creature — Wizard",
    "oracle_text": "Card abilities...",
    "colors": ["U"],
    "color_identity": ["U"],
    "legalities": {
      "commander": "legal",
      "modern": "legal"
    }
  }
]
```

## Script Options

### `--format=` (default: commander)

Specify which format legality to use:

- `commander` - Commander/EDH legal cards
- `standard` - Standard format
- `modern` - Modern format
- `legacy` - Legacy format
- `vintage` - Vintage format

### `--limit` (default: 500)

Maximum number of cards to fetch:

```bash
npx tsx scripts/fetch-cards-for-db.ts --limit=1000
```

### `--output=` (default: ./my-card-database.json)

Output file path:

```bash
npx tsx scripts/fetch-cards-for-db.ts --output=./my-custom-db.json
```

## Examples

### Fetch 500 Commander cards:

```bash
npx tsx scripts/fetch-cards-for-db.ts --format=commander --limit=500
```

### Fetch 1000 Modern cards:

```bash
npx tsx scripts/fetch-cards-for-db.ts --format=modern --limit=1000
```

### Fetch with custom output:

```bash
npx tsx scripts/fetch-cards-for-db.ts --format=commander --limit=750 --output=./commander-cards.json
```

## Database Management

### View Database Status

Go to **Settings → Database Management** to see:

- Total card count
- Cached image count
- Database status (Empty/Ready)

### Clear Database

To remove all card data:

1. Go to **Settings → Database Management**
2. Click **"Clear Entire Database"** in the Danger Zone section
3. Confirm the action

⚠️ **Warning:** This cannot be undone.

## Image Caching

Planar Nexus automatically caches card images in IndexedDB for faster loading. The cache:

- Stores images locally for offline use
- Uses LRU (Least Recently Used) eviction
- Clears independently from card data

### Clear Image Cache Only

```typescript
import { clearImageCache } from "@/lib/card-database";
await clearImageCache();
```

## Troubleshooting

### Import fails with "Invalid format"

- Ensure your JSON file is an array of card objects
- Check that each card has required fields: `id`, `name`, `cmc`, `type_line`, `colors`, `legalities`

### Import is slow

- Large imports (1000+ cards) may take 30-60 seconds
- Be patient and don't refresh the page during import

### "Database not initialized" error

- Refresh the page and try again
- Check browser console for errors

### Card search not working after import

- Wait for import to complete fully
- Check that cards were imported: Settings → Database Management
- Try refreshing the page

## Legal Notice

**IMPORTANT:** This tool is for **personal use only**.

- ✅ You may fetch cards for your own personal card database
- ✅ You may use the app to playtest with your fetched cards
- ❌ Do not distribute pre-generated card data files
- ❌ Do not use card data for commercial purposes

Card data is fetched from the [Scryfall API](https://scryfall.com/docs/api) which is free for personal and non-commercial use.

## API Rate Limiting

The fetch script respects Scryfall's rate limits:

- ~10 requests per second
- 100ms delay between requests
- Automatic pagination for large requests

## Technical Details

### IndexedDB Schema

```
PlanarNexusCardDB (version 2)
├── cards (object store)
│   ├── keyPath: "id"
│   ├── index: "name"
│   ├── index: "name_lower"
│   └── index: "format_legality"
└── card_images (object store)
    └── keyPath: "cardId"
```

### Import Process

1. JSON file is parsed and validated
2. Cards are imported in batches of 100
3. Progress updates after each batch
4. Fuse.js search index is rebuilt after import
5. Database stats are updated

### Performance

- **Import speed:** ~50-100 cards/second
- **Search speed:** <100ms for 500+ cards
- **Storage:** ~1-2KB per card (without images)

## Support

For issues or questions:

- Check the [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- Review the browser console for errors
- Ensure you're using the latest version of the app
