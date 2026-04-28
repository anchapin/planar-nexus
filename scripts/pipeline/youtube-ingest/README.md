# YouTube Video Ingestion & Transcript Download Pipeline

## Overview

This is Stage 1 of the AI Video Analysis Pipeline for Planar Nexus. It fetches MTG gameplay videos from YouTube and downloads their transcripts for analysis.

## Features

- **YouTube Data API v3 Integration**: Enumerates videos from target MTG channels
- **Keyword Filtering**: Filters content by gameplay keywords (game, match, gameplay, draft, constructed)
- **Transcript Download**: Uses `yt-dlp` to download auto-captions/transcripts
- **Metadata Storage**: Stores video ID, channel, publish date, and caption segments
- **Incremental Downloads**: Skips already-downloaded transcripts
- **Rate Limiting**: Respects API limits with configurable delays

## Target Channels

- Tolarian Community College
- ChannelFireball (Reid Duke)
- The Command Zone
- Game Knights
- SCG Tour / Pro Tour coverage
- Spikes Academy
- Limited Resources
- Strictly Better MTG

## Prerequisites

1. **YouTube Data API v3 Key**:
   ```bash
   # Create a project at https://console.cloud.google.com/
   # Enable YouTube Data API v3
   # Create credentials (API Key)
   export YOUTUBE_API_KEY=your_api_key_here
   ```

2. **yt-dlp** (for transcript download):
   ```bash
   # Ubuntu/Debian
   sudo apt install yt-dlp

   # macOS
   brew install yt-dlp

   # Or via pip
   pip install yt-dlp
   ```

3. **Node.js 20+** (already in project dependencies)

## Usage

### Run the pipeline

```bash
# From project root
npm run pipeline:youtube-ingest

# Or directly with ts-node
npx ts-node scripts/pipeline/youtube-ingest/youtube-ingest.ts
```

### Output

Transcripts are saved to:
```
data/raw/youtube-transcripts/
├── {videoId}.json              # Individual transcript files
└── ingestion-report-{timestamp}.json  # Summary report
```

### Transcript File Format

Each transcript file contains:

```json
{
  "videoId": "abc123xyz",
  "channelTitle": "Tolarian Community College",
  "title": "MTG Gameplay: Draft Analysis",
  "publishedAt": "2024-01-15T10:00:00Z",
  "transcript": [
    {
      "text": "Welcome to the gameplay video",
      "start": 0.0,
      "duration": 2.5
    },
    {
      "text": "Today we're drafting a blue-white deck",
      "start": 2.5,
      "duration": 3.2
    }
  ],
  "downloadTimestamp": "2024-04-28T12:00:00Z"
}
```

## Configuration

Edit the configuration in `youtube-ingest.ts`:

```typescript
const CONFIG = {
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
  MAX_VIDEOS_PER_CHANNEL: 50,  // Videos per channel
  OUTPUT_DIR: join(process.cwd(), 'data', 'raw', 'youtube-transcripts'),
  BATCH_SIZE: 10,
  REQUEST_DELAY_MS: 1000,      // Delay between API requests
};
```

## Pipeline Stages

### Phase 1: Video Enumeration
- Fetches videos from target channels
- Filters by gameplay keywords in title/description
- Collects metadata (views, likes, duration)

### Phase 2: Transcript Download
- Downloads auto-captions using yt-dlp
- Parses JSON3 subtitle format
- Skips already-downloaded transcripts

### Phase 3: Report Generation
- Creates summary report with statistics
- Lists successful and failed downloads

## Acceptance Criteria

- [x] Script successfully downloads transcripts for at least 50 videos per target channel
- [x] Output includes video ID, channel name, publish date, and aligned caption segments
- [x] Pipeline is idempotent (can be run multiple times)
- [x] Handles errors gracefully (missing transcripts, API limits)
- [x] Generates summary report for validation

## Troubleshooting

### "No transcript available"
- Video may not have auto-captions enabled
- yt-dlp may not support the subtitle format
- Check with: `yt-dlp --list-subs https://www.youtube.com/watch?v=VIDEO_ID`

### API quota exceeded
- YouTube API has daily quotas (10,000 units/day default)
- Each video detail request costs 1 unit
- Reduce `MAX_VIDEOS_PER_CHANNEL` or request quota increase

### yt-dlp not found
- Install yt-dlp: `pip install yt-dlp` or `brew install yt-dlp`
- Verify installation: `yt-dlp --version`

## Next Steps

After running this pipeline:

1. **Stage 2**: Process transcripts for card mentions and gameplay events
2. **Stage 3**: Extract decklists and game state information
3. **Stage 4**: Train AI models on the processed data

## References

- Brainstorm doc §4.1 — Stage 1: Video Ingestion & Preprocessing
- YouTube Data API v3: https://developers.google.com/youtube/v3
- yt-dlp documentation: https://github.com/yt-dlp/yt-dlp
