/**
 * Type definitions for YouTube Video Ingestion Pipeline
 */

export interface VideoMetadata {
  /** YouTube video ID */
  videoId: string;
  /** YouTube channel ID */
  channelId: string;
  /** Channel display name */
  channelTitle: string;
  /** Video title */
  title: string;
  /** Video description */
  description: string;
  /** ISO 8601 publish timestamp */
  publishedAt: string;
  /** Thumbnail URL (high quality) */
  thumbnailUrl: string;
  /** ISO 8601 duration (PT1H2M3S) */
  duration: string;
  /** View count */
  viewCount: number;
  /** Like count */
  likeCount: number;
  /** Keywords that matched this video */
  keywords: string[];
}

export interface TranscriptSegment {
  /** Caption text */
  text: string;
  /** Start time in seconds */
  start: number;
  /** Duration in seconds */
  duration: number;
}

export interface TranscriptData {
  /** YouTube video ID */
  videoId: string;
  /** Channel name */
  channelTitle: string;
  /** Video title */
  title: string;
  /** ISO 8601 publish timestamp */
  publishedAt: string;
  /** Transcript segments */
  transcript: TranscriptSegment[];
  /** ISO 8601 download timestamp */
  downloadTimestamp: string;
}

export interface IngestionReport {
  /** Report generation timestamp */
  generatedAt: string;
  /** Summary statistics */
  summary: {
    /** Number of channels queried */
    totalChannels: number;
    /** Total videos found */
    totalVideosFound: number;
    /** Transcripts successfully downloaded */
    transcriptsDownloaded: number;
    /** Transcripts that failed */
    transcriptsFailed: number;
    /** Success rate percentage */
    successRate: string;
  };
  /** All video metadata */
  videos: VideoMetadata[];
  /** List of video IDs with downloaded transcripts */
  downloaded: string[];
  /** List of video IDs that failed */
  failed: string[];
}

export interface PipelineConfig {
  /** YouTube Data API v3 key */
  YOUTUBE_API_KEY: string;
  /** Maximum videos to fetch per channel */
  MAX_VIDEOS_PER_CHANNEL: number;
  /** Output directory path */
  OUTPUT_DIR: string;
  /** Batch size for processing */
  BATCH_SIZE: number;
  /** Delay between API requests (ms) */
  REQUEST_DELAY_MS: number;
}

export interface YouTubeApiSearchResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  regionCode: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubeApiSearchItem[];
}

export interface YouTubeApiSearchItem {
  kind: string;
  etag: string;
  id: {
    kind: string;
    videoId?: string;
  };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: {
      default?: { url: string; width: number; height: number };
      medium?: { url: string; width: number; height: number };
      high?: { url: string; width: number; height: number };
    };
    channelTitle: string;
  };
}

export interface YouTubeApiVideoResponse {
  kind: string;
  etag: string;
  items: YouTubeApiVideoItem[];
}

export interface YouTubeApiVideoItem {
  kind: string;
  etag: string;
  id: string;
  contentDetails: {
    duration: string;
    dimension: string;
    definition: string;
    caption: string;
    licensedContent: boolean;
  };
  statistics: {
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
}
