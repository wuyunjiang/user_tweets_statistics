export const TWEET_TYPES = [
  '转推推文',
  '引用推文',
  '投票推文',
  '纯文本发帖',
  '多媒体发帖',
  '链接推文',
  '空间分享推文',
  '推文串/连推 (Threads)',
  '文章',
  '其他',
] as const;

export type TweetType = (typeof TWEET_TYPES)[number];

export interface ApiTweet {
  id: string;
  text?: string;
  createdAt: string;
  retweetCount?: number;
  favoriteCount?: number;
  replyCount?: number;
  quoteCount?: number;
  userScreenName?: string;
  userName?: string;
  userIdStr?: string;
  userFollowers?: number;
  userVerified?: boolean;
  conversationId?: string;
  language?: string;
  isQuote?: boolean;
  isReply?: boolean;
  isRetweet?: boolean;
  urls?: Array<{
    url?: string;
    expandedUrl?: string;
    displayUrl?: string;
  }>;
  media?: Array<{
    type?: string;
    mediaUrl?: string;
  }>;
  poll?: unknown;
}

export interface TweetRecord {
  id: string;
  text: string;
  url: string | null;
  type: TweetType;
  createdAt: string;
  createdLabel: string;
  commentCount: number;
  rtCount: number;
  likeCount: number;
}

export interface QueryFormState {
  username: string;
  startDate: string | null;
}

export interface PersistedSnapshot {
  query: QueryFormState;
  records: TweetRecord[];
  savedAt: string;
}

export interface ScrapeStatus {
  browserReady: boolean;
  loggedIn: boolean;
  profilePath: string;
}

export interface ScrapeJobStartResponse {
  jobId: string;
}

export interface ScrapeProgressEvent {
  jobId: string;
  phase: 'queued' | 'running' | 'done' | 'error';
  message?: string;
  responseCount: number;
  collectedCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
  checkpointCreatedAt?: string | null;
  records?: ApiTweet[];
  error?: string;
}
