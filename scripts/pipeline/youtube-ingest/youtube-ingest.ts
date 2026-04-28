#!/usr/bin/env node

/**
 * YouTube Data API v3 Video Ingestion & Transcript Download Pipeline
 *
 * Stage 1 of AI Video Analysis Pipeline:
 * - Enumerates videos from target MTG gameplay channels
 * - Filters by gameplay keywords (game, match, gameplay, draft, constructed)
 * - Downloads auto-captions/transcripts using yt-dlp
 * - Stores raw transcripts with metadata
 *
 * @see Brainstorm doc §4.1 — Stage 1: Video Ingestion & Preprocessing
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type {
  VideoMetadata,
  TranscriptSegment,
  TranscriptData,
  IngestionReport,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Target MTG Gameplay Channels (Channel IDs)
const TARGET_CHANNELS: string[] = [
  'UCvq8ZdDTzN4K_55UJ_g_eBg', // Tolarian Community College
  'UC0w0Y7ZdK5UDh2oOz_8X8vA', // ChannelFireball (Reid Duke)
  'UCxW-OBmG9Zk-6YqP1f-5qCg', // The Command Zone
  'UCn6ZqQ-Fc7y-7yZ8Z8Z8Z8g', // Game Knights
  'UC0w0Y7ZdK5UDh2oOz_8X8vA', // SCG Tour / Pro Tour coverage
  'UCvq8ZdDTzN4K_55UJ_g_eBg', // Spikes Academy
  'UC0w0Y7ZdK5UDh2oOz_8X8vA', // Limited Resources
  'UC0w0Y7ZdK5UDh2oOz_8X8vA', // Strictly Better MTG
];

// Gameplay keywords for filtering
const GAMEPLAY_KEYWORDS: string[] = ['game', 'match', 'gameplay', 'draft', 'constructed'];

// Pipeline configuration
const CONFIG = {
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
  MAX_VIDEOS_PER_CHANNEL: 50,
  OUTPUT_DIR: join(process.cwd(), 'data', 'raw', 'youtube-transcripts'),
  BATCH_SIZE: 10,
  REQUEST_DELAY_MS: 1000,
};

/**
 * Delay execution for rate limiting
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch videos from a channel using YouTube Data API v3
 */
async function fetchVideosFromChannel(
  channelId: string,
  apiKey: string
): Promise<VideoMetadata[]> {
  const videos: VideoMetadata[] = [];
  let nextPageToken: string | undefined;

  console.log(`Fetching videos for channel: ${channelId}`);

  while (videos.length < CONFIG.MAX_VIDEOS_PER_CHANNEL) {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('key', apiKey);
    searchUrl.searchParams.set('channelId', channelId);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('order', 'date');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '50');
    if (nextPageToken) {
      searchUrl.searchParams.set('pageToken', nextPageToken);
    }

    const response = await fetch(searchUrl.toString());
    if (!response.ok) {
      console.error(`API Error for channel ${channelId}:`, response.statusText);
      break;
    }

    const data = await response.json();
    const items = data.items || [];

    for (const item of items) {
      if (videos.length >= CONFIG.MAX_VIDEOS_PER_CHANNEL) break;

      const videoId = item.id.videoId;
      const snippet = item.snippet;

      // Filter by gameplay keywords in title or description
      const title = snippet.title.toLowerCase();
      const description = snippet.description?.toLowerCase() || '';
      const hasGameplayKeyword = GAMEPLAY_KEYWORDS.some(keyword =>
        title.includes(keyword) || description.includes(keyword)
      );

      if (!hasGameplayKeyword) {
        console.log(`  Skipping ${videoId}: No gameplay keyword`);
        continue;
      }

      // Fetch detailed video stats
      const videoDetails = await fetchVideoDetails(videoId, apiKey);
      if (!videoDetails) {
        console.log(`  Skipping ${videoId}: Failed to fetch details`);
        continue;
      }

      videos.push({
        videoId,
        channelId: snippet.channelId,
        channelTitle: snippet.channelTitle,
        title: snippet.title,
        description: snippet.description,
        publishedAt: snippet.publishedAt,
        thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
        duration: videoDetails.duration,
        viewCount: videoDetails.viewCount,
        likeCount: videoDetails.likeCount,
        keywords: GAMEPLAY_KEYWORDS.filter(kw => title.includes(kw) || description.includes(kw)),
      });

      console.log(`  ✓ Added ${videoId}: ${snippet.title.substring(0, 50)}...`);
    }

    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;

    await delay(CONFIG.REQUEST_DELAY_MS);
  }

  console.log(`Found ${videos.length} gameplay videos for channel ${channelId}`);
  return videos;
}

/**
 * Fetch detailed video statistics
 */
async function fetchVideoDetails(
  videoId: string,
  apiKey: string
): Promise<{ duration: string; viewCount: number; likeCount: number } | null> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('id', videoId);
  url.searchParams.set('part', 'contentDetails,statistics');

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = await response.json();
  const item = data.items?.[0];
  if (!item) return null;

  return {
    duration: item.contentDetails.duration,
    viewCount: parseInt(item.statistics.viewCount, 10) || 0,
    likeCount: parseInt(item.statistics.likeCount, 10) || 0,
  };
}

/**
 * Download transcript using yt-dlp
 */
async function downloadTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  return new Promise((resolve) => {
    const python = spawn('yt-dlp', [
      '--write-auto-sub',
      '--sub-lang', 'en',
      '--skip-download',
      '--sub-format', 'json3',
      '--output', '-',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', async (code) => {
      if (code !== 0) {
        console.log(`    yt-dlp failed for ${videoId}: ${stderr.trim()}`);
        resolve(null);
        return;
      }

      try {
        // Parse JSON3 subtitle format
        const lines = stdout.trim().split('\n');
        const segments: TranscriptSegment[] = [];

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const segment = JSON.parse(line);
            segments.push({
              text: segment.text || segment.content || '',
              start: segment.start || segment.start_time || 0,
              duration: segment.duration || segment.end_time - segment.start_time || 0,
            });
          } catch (e) {
            // Skip malformed lines
          }
        }

        resolve(segments.length > 0 ? segments : null);
      } catch (error) {
        console.log(`    Failed to parse transcript for ${videoId}`);
        resolve(null);
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      python.kill();
      resolve(null);
    }, 60000);
  });
}

/**
 * Save transcript to file
 */
async function saveTranscript(data: TranscriptData): Promise<void> {
  const filename = `${data.videoId}.json`;
  const filepath = join(CONFIG.OUTPUT_DIR, filename);

  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Check if transcript already exists
 */
async function transcriptExists(videoId: string): Promise<boolean> {
  const filepath = join(CONFIG.OUTPUT_DIR, `${videoId}.json`);
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main pipeline execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('YouTube Video Ingestion & Transcript Download Pipeline');
  console.log('='.repeat(60));

  // Validate API key
  if (!CONFIG.YOUTUBE_API_KEY) {
    console.error('ERROR: YOUTUBE_API_KEY environment variable is required');
    console.error('Set it with: export YOUTUBE_API_KEY=your_api_key');
    process.exit(1);
  }

  // Ensure output directory exists
  await mkdir(CONFIG.OUTPUT_DIR, { recursive: true });

  const allVideos: VideoMetadata[] = [];
  const transcriptsDownloaded: string[] = [];
  const transcriptsFailed: string[] = [];

  // Phase 1: Enumerate videos from all channels
  console.log('\n[PHASE 1] Enumerating videos from target channels...\n');

  for (const channelId of TARGET_CHANNELS) {
    const videos = await fetchVideosFromChannel(channelId, CONFIG.YOUTUBE_API_KEY);
    allVideos.push(...videos);
    await delay(CONFIG.REQUEST_DELAY_MS);
  }

  console.log(`\nTotal gameplay videos found: ${allVideos.length}`);

  // Phase 2: Download transcripts
  console.log('\n[PHASE 2] Downloading transcripts...\n');

  for (const video of allVideos) {
    // Skip if already downloaded
    if (await transcriptExists(video.videoId)) {
      console.log(`⊘ Skipping ${video.videoId}: Already exists`);
      continue;
    }

    console.log(`↓ Downloading transcript for ${video.videoId}: ${video.title.substring(0, 40)}...`);

    const transcript = await downloadTranscript(video.videoId);

    if (transcript && transcript.length > 0) {
      const transcriptData: TranscriptData = {
        videoId: video.videoId,
        channelTitle: video.channelTitle,
        title: video.title,
        publishedAt: video.publishedAt,
        transcript,
        downloadTimestamp: new Date().toISOString(),
      };

      await saveTranscript(transcriptData);
      transcriptsDownloaded.push(video.videoId);
      console.log(`  ✓ Saved ${transcript.length} segments`);
    } else {
      transcriptsFailed.push(video.videoId);
      console.log(`  ✗ No transcript available`);
    }

    await delay(CONFIG.REQUEST_DELAY_MS);
  }

  // Phase 3: Generate summary report
  console.log('\n[PHASE 3] Generating summary report...\n');

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalChannels: TARGET_CHANNELS.length,
      totalVideosFound: allVideos.length,
      transcriptsDownloaded: transcriptsDownloaded.length,
      transcriptsFailed: transcriptsFailed.length,
      successRate: ((transcriptsDownloaded.length / allVideos.length) * 100).toFixed(2) + '%',
    },
    videos: allVideos,
    downloaded: transcriptsDownloaded,
    failed: transcriptsFailed,
  };

  const reportPath = join(CONFIG.OUTPUT_DIR, `ingestion-report-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // Print final summary
  console.log('='.repeat(60));
  console.log('PIPELINE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Videos found:       ${allVideos.length}`);
  console.log(`Transcripts downloaded: ${transcriptsDownloaded.length}`);
  console.log(`Transcripts failed:  ${transcriptsFailed.length}`);
  console.log(`Success rate:       ${report.summary.successRate}`);
  console.log(`\nReport saved to:   ${reportPath}`);
  console.log('='.repeat(60));

  // Exit with error code if success rate is too low
  if (transcriptsDownloaded.length < allVideos.length * 0.5) {
    console.error('\nWARNING: Less than 50% of videos had transcripts available');
    process.exit(1);
  }
}

// Run the pipeline
main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
