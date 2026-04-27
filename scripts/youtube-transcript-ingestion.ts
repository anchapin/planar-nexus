#!/usr/bin/env node

/**
 * YouTube Transcript Ingestion Script
 *
 * Part of the AI Video Analysis pipeline (Stage 1).
 * Fetches MTG gameplay videos and their transcripts from YouTube.
 *
 * Usage:
 *   npx tsx scripts/youtube-transcript-ingestion.ts --channel "Tolarian Community College" --limit 50
 *   npx tsx scripts/youtube-transcript-ingestion.ts --all-channels
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target MTG content channels
const TARGET_CHANNELS = [
  'Tolarian Community College',
  'ChannelFireball',
  'The Command Zone',
  'Game Knights',
  'SCG Tour',
  'Pro Tour coverage',
  'Spikes Academy',
  'Limited Resources',
  'Strictly Better MTG',
  'Reid Duke',
  'Reid Duke ChannelFireball',
  'Alpha Investments',
  'MTGGoldfish',
  'LoadingReadyRun',
  'ChannelFireball Magic',
  'ChannelFireball Magic: The Gathering',
  'Star City Games',
  'Magic: The Gathering',
  'Wizards of the Coast',
  'MTG',
];

// Keywords to filter gameplay content
const GAMEPLAY_KEYWORDS = [
  'game',
  'match',
  'gameplay',
  'draft',
  'constructed',
  'commander',
  'standard',
  'modern',
  'pioneer',
  'legacy',
  'pauper',
  'limited',
  'sealed',
  'tournament',
  'competitive',
  'playtest',
];

interface VideoMetadata {
  videoId: string;
  title: string;
  channel: string;
  publishDate: string;
  duration: string;
  viewCount?: string;
  transcriptPath?: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptData {
  videoId: string;
  videoTitle: string;
  channel: string;
  publishDate: string;
  segments: TranscriptSegment[];
}

/**
 * Check if a video title suggests gameplay content
 */
function isGameplayContent(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return GAMEPLAY_KEYWORDS.some(keyword => lowerTitle.includes(keyword));
}

/**
 * Fetch videos from a YouTube channel using yt-dlp
 */
async function fetchChannelVideos(
  channelName: string,
  limit: number = 50
): Promise<VideoMetadata[]> {
  return new Promise((resolve, reject) => {
    console.log(`Fetching videos from channel: ${channelName}`);

    const args = [
      '--flat-playlist',
      '--print',
      '%(id)s|%(title)s|%(channel)s|%(upload_date)s|%(duration)s|%(view_count)s',
      '--playlist-end',
      limit.toString(),
      'ytsearchdate:' + `${channelName}`,
    ];

    const ytDlp = spawn('yt-dlp', args);
    let output = '';
    let error = '';

    ytDlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytDlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytDlp.on('close', async (code) => {
      if (code !== 0) {
        console.error(`yt-dlp exited with code ${code}`);
        console.error(`Error: ${error}`);
        // Try alternative format
        try {
          const altVideos = await fetchChannelVideosAlternative(channelName, limit);
          resolve(altVideos);
        } catch (altError) {
          reject(new Error(`Failed to fetch videos: ${error}`));
        }
        return;
      }

      const videos: VideoMetadata[] = output
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [id, title, channel, uploadDate, duration, viewCount] =
            line.split('|');
          return {
            videoId: id,
            title,
            channel,
            publishDate: uploadDate,
            duration,
            viewCount,
          };
        })
        .filter((video) => isGameplayContent(video.title));

      console.log(`Found ${videos.length} gameplay videos from ${channelName}`);
      resolve(videos);
    });
  });
}

/**
 * Alternative method to fetch videos
 */
async function fetchChannelVideosAlternative(
  channelName: string,
  limit: number
): Promise<VideoMetadata[]> {
  return new Promise((resolve, reject) => {
    console.log(`Trying alternative method for: ${channelName}`);

    const args = [
      '--flat-playlist',
      '--print',
      '%(id)s|%(title)s|%(channel)s|%(upload_date)s|%(duration)s',
      '--playlist-end',
      limit.toString(),
      `${channelName}`,
    ];

    const ytDlp = spawn('yt-dlp', args);
    let output = '';
    let error = '';

    ytDlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytDlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Alternative method also failed: ${error}`));
        return;
      }

      const videos: VideoMetadata[] = output
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const [id, title, channel, uploadDate, duration] = line.split('|');
          return {
            videoId: id,
            title,
            channel,
            publishDate: uploadDate,
            duration,
          };
        })
        .filter((video) => isGameplayContent(video.title));

      resolve(videos);
    });
  });
}

/**
 * Download transcript for a video using yt-dlp
 */
async function downloadTranscript(videoId: string): Promise<TranscriptData | null> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading transcript for video: ${videoId}`);

    const args = [
      '--write-auto-sub',
      '--skip-download',
      '--sub-format',
      'vtt',
      '--sub-lang',
      'en',
      '--output',
      `%(id)s.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const ytDlp = spawn('yt-dlp', args);
    let output = '';
    let error = '';

    ytDlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytDlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytDlp.on('close', async (code) => {
      if (code !== 0) {
        console.warn(`No transcript available for ${videoId}`);
        resolve(null);
        return;
      }

      // Parse the VTT file
      try {
        const vttPath = path.join(process.cwd(), `${videoId}.en.vtt`);
        const vttContent = await fs.readFile(vttPath, 'utf-8');

        // Clean up the VTT file
        await fs.unlink(vttPath).catch(() => {});

        const transcript = parseVTT(vttContent, videoId);
        resolve(transcript);
      } catch (err) {
        console.error(`Failed to parse transcript for ${videoId}:`, err);
        resolve(null);
      }
    });
  });
}

/**
 * Parse VTT subtitle format into transcript segments
 */
function parseVTT(vttContent: string, videoId: string): TranscriptData {
  const lines = vttContent.split('\n');
  const segments: TranscriptSegment[] = [];

  let currentSegment: Partial<TranscriptSegment> | null = null;
  let inSegment = false;

  for (const line of lines) {
    // Skip header and empty lines
    if (line.startsWith('WEBVTT') || line.trim() === '') {
      continue;
    }

    // Parse timestamp line
    const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (timestampMatch) {
      if (currentSegment && currentSegment.text) {
        segments.push(currentSegment as TranscriptSegment);
      }

      const [, start, end] = timestampMatch;
      currentSegment = {
        start: parseTimestamp(start),
        end: parseTimestamp(end),
        text: '',
      };
      inSegment = true;
      continue;
    }

    // Skip metadata lines
    if (line.includes('Kind:') || line.includes('Language:')) {
      continue;
    }

    // Collect text content
    if (inSegment && currentSegment) {
      const text = line
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();

      if (text) {
        currentSegment.text += (currentSegment.text ? ' ' : '') + text;
      }
    }
  }

  // Add the last segment
  if (currentSegment && currentSegment.text) {
    segments.push(currentSegment as TranscriptSegment);
  }

  return {
    videoId,
    videoTitle: '',
    channel: '',
    publishDate: '',
    segments,
  };
}

/**
 * Parse VTT timestamp to seconds
 */
function parseTimestamp(timestamp: string): number {
  const [hours, minutes, seconds] = timestamp.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Save transcript to JSON file
 */
async function saveTranscript(
  transcript: TranscriptData,
  outputDir: string
): Promise<string> {
  const dir = path.join(process.cwd(), outputDir, 'transcripts');
  await fs.mkdir(dir, { recursive: true });

  const filename = `${transcript.videoId}.json`;
  const filepath = path.join(dir, filename);

  await fs.writeFile(filepath, JSON.stringify(transcript, null, 2));

  return filepath;
}

/**
 * Save video metadata to JSON file
 */
async function saveVideoMetadata(
  videos: VideoMetadata[],
  channelName: string,
  outputDir: string
): Promise<string> {
  const dir = path.join(process.cwd(), outputDir, 'metadata');
  await fs.mkdir(dir, { recursive: true });

  const filename = `${channelName.replace(/\s+/g, '_').toLowerCase()}_videos.json`;
  const filepath = path.join(dir, filename);

  await fs.writeFile(filepath, JSON.stringify(videos, null, 2));

  return filepath;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  let channelName: string | null = null;
  let limit = 50;
  let outputDir = 'data/youtube-ingestion';
  let allChannels = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--channel' && args[i + 1]) {
      channelName = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--output') {
      outputDir = args[++i];
    } else if (arg === '--all-channels') {
      allChannels = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
YouTube Transcript Ingestion Script

Usage:
  npx tsx scripts/youtube-transcript-ingestion.ts --channel "Channel Name" --limit 50
  npx tsx scripts/youtube-transcript-ingestion.ts --all-channels

Options:
  --channel <name>   Specific channel to fetch videos from
  --limit <number>   Maximum number of videos to fetch (default: 50)
  --output <dir>     Output directory (default: data/youtube-ingestion)
  --all-channels     Fetch from all target MTG channels
  --help, -h         Show this help message

Target Channels:
  ${TARGET_CHANNELS.join('\n  ')}
      `);
      process.exit(0);
    }
  }

  // Check if yt-dlp is installed
  try {
    await new Promise<void>((resolve, reject) => {
      const check = spawn('yt-dlp', ['--version']);
      check.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('yt-dlp not found'));
      });
    });
  } catch {
    console.error('Error: yt-dlp is not installed or not in PATH');
    console.error('Install it from: https://github.com/yt-dlp/yt-dlp');
    process.exit(1);
  }

  const channelsToProcess = allChannels
    ? TARGET_CHANNELS
    : channelName
      ? [channelName]
      : TARGET_CHANNELS.slice(0, 3); // Default to first 3 channels

  console.log('=== YouTube Transcript Ingestion ===');
  console.log(`Channels to process: ${channelsToProcess.length}`);
  console.log(`Videos per channel: ${limit}`);
  console.log(`Output directory: ${outputDir}`);
  console.log();

  const allVideos: VideoMetadata[] = [];
  let transcriptsDownloaded = 0;
  let transcriptsFailed = 0;

  for (const channel of channelsToProcess) {
    console.log(`\n--- Processing: ${channel} ---`);

    try {
      // Fetch videos
      const videos = await fetchChannelVideos(channel, limit);
      allVideos.push(...videos);

      // Save metadata
      const metadataPath = await saveVideoMetadata(videos, channel, outputDir);
      console.log(`Saved metadata to: ${metadataPath}`);

      // Download transcripts
      for (const video of videos) {
        const transcript = await downloadTranscript(video.videoId);
        if (transcript) {
          transcript.videoTitle = video.title;
          transcript.channel = video.channel;
          transcript.publishDate = video.publishDate;

          const transcriptPath = await saveTranscript(transcript, outputDir);
          console.log(`  ✓ Saved transcript: ${video.videoId}`);
          transcriptsDownloaded++;
        } else {
          console.log(`  ✗ No transcript: ${video.videoId}`);
          transcriptsFailed++;
        }
      }
    } catch (error) {
      console.error(`Failed to process channel ${channel}:`, error);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total videos found: ${allVideos.length}`);
  console.log(`Transcripts downloaded: ${transcriptsDownloaded}`);
  console.log(`Transcripts unavailable: ${transcriptsFailed}`);
  console.log(`Success rate: ${((transcriptsDownloaded / allVideos.length) * 100).toFixed(1)}%`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
