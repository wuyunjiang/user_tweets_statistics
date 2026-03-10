import dayjs from 'dayjs';
import type { ApiTweet, TweetRecord, TweetType } from '../types';

const threadPattern = /(\b1\/\d+\b)|(\bthread\b)|(\b🧵\b)/i;
const articlePattern = /(twitter\.com\/i\/articles|x\.com\/i\/articles|read more|longform)/i;
const spacePattern = /(x\.com\/i\/spaces|twitter\.com\/i\/spaces|hosted a space|joined this space|set a reminder for my upcoming space)/i;

function hasUrl(tweet: ApiTweet) {
  return Boolean(tweet.urls?.length) || /(https?:\/\/|www\.)/i.test(tweet.text ?? '');
}

function hasMedia(tweet: ApiTweet) {
  return Boolean(tweet.media?.length);
}

function isRetweet(tweet: ApiTweet) {
  const text = tweet.text ?? '';
  return Boolean(tweet.isRetweet) || text.startsWith('RT @');
}

export function classifyTweet(tweet: ApiTweet): TweetType {
  const text = tweet.text?.trim() ?? '';

  if (isRetweet(tweet)) {
    return '转推推文';
  }
  if (tweet.isQuote) {
    return '引用推文';
  }
  if (tweet.poll) {
    return '投票推文';
  }
  if (spacePattern.test(text)) {
    return '空间分享推文';
  }
  if (articlePattern.test(text) || tweet.urls?.some((item) => articlePattern.test(item.displayUrl ?? item.expandedUrl ?? item.url ?? ''))) {
    return '文章';
  }
  if (threadPattern.test(text)) {
    return '推文串/连推 (Threads)';
  }
  if (hasMedia(tweet)) {
    return '多媒体发帖';
  }
  if (hasUrl(tweet)) {
    return '链接推文';
  }
  if (text) {
    return '纯文本发帖';
  }
  return '其他';
}

export function normalizeUsername(input: string) {
  return input.trim().replace(/^@+/, '');
}

export function mapTweet(tweet: ApiTweet): TweetRecord {
  const created = dayjs(tweet.createdAt);
  const url = tweet.userScreenName
    ? `https://x.com/${tweet.userScreenName}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;
  return {
    id: tweet.id,
    text: tweet.text ?? '',
    url,
    type: classifyTweet(tweet),
    createdAt: created.toISOString(),
    createdLabel: created.format('YYYY-MM-DD HH:mm:ss'),
    commentCount: tweet.replyCount ?? 0,
    rtCount: tweet.retweetCount ?? 0,
    likeCount: tweet.favoriteCount ?? 0,
  };
}

export function mapTweets(tweets: ApiTweet[]) {
  return tweets
    .map(mapTweet)
    .sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
}

export function buildTypeChartData(records: TweetRecord[]) {
  const grouped = new Map<TweetType, number>();
  records.forEach((record) => {
    grouped.set(record.type, (grouped.get(record.type) ?? 0) + 1);
  });
  return Array.from(grouped.entries()).map(([type, count]) => ({ type, count }));
}

export function buildTimelineData(records: TweetRecord[], granularity: '4h' | 'day' | 'week' | 'month') {
  const grouped = new Map<string, number>();
  const bucketValues = new Map<string, number>();

  function resolveBucket(record: TweetRecord) {
    const createdAt = dayjs(record.createdAt);
    let bucket = createdAt.startOf('day');

    if (granularity === '4h') {
      bucket = createdAt.minute(0).second(0).millisecond(0).hour(Math.floor(createdAt.hour() / 4) * 4);
    } else if (granularity === 'week') {
      const dayOfWeek = createdAt.day();
      bucket = createdAt.startOf('day').subtract(dayOfWeek, 'day');
    } else if (granularity === 'month') {
      bucket = createdAt.startOf('month');
    }

    const label =
      granularity === '4h'
        ? bucket.format('MM-DD HH:00')
        : granularity === 'day'
          ? bucket.format('YYYY-MM-DD')
          : granularity === 'week'
            ? `${bucket.format('YYYY-MM-DD')} 周`
            : bucket.format('YYYY-MM');

    return { label, sortValue: bucket.valueOf() };
  }

  records.forEach((record) => {
    const { label, sortValue } = resolveBucket(record);
    grouped.set(label, (grouped.get(label) ?? 0) + 1);
    bucketValues.set(label, sortValue);
  });
  return Array.from(grouped.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (bucketValues.get(a.date) ?? 0) - (bucketValues.get(b.date) ?? 0));
}

export function buildTimelineSeriesData(records: TweetRecord[], granularity: '4h' | 'day' | 'week' | 'month') {
  const grouped = new Map<string, number>();
  const bucketValues = new Map<string, number>();

  records.forEach((record) => {
    const createdAt = dayjs(record.createdAt);
    let bucket = createdAt.startOf('day');

    if (granularity === '4h') {
      bucket = createdAt.minute(0).second(0).millisecond(0).hour(Math.floor(createdAt.hour() / 4) * 4);
    } else if (granularity === 'week') {
      bucket = createdAt.startOf('day').subtract(createdAt.day(), 'day');
    } else if (granularity === 'month') {
      bucket = createdAt.startOf('month');
    }

    const date =
      granularity === '4h'
        ? bucket.format('MM-DD HH:00')
        : granularity === 'day'
          ? bucket.format('YYYY-MM-DD')
          : granularity === 'week'
            ? `${bucket.format('YYYY-MM-DD')} 周`
            : bucket.format('YYYY-MM');

    const key = `${date}__${record.type}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
    const totalKey = `${date}__总量`;
    grouped.set(totalKey, (grouped.get(totalKey) ?? 0) + 1);
    bucketValues.set(date, bucket.valueOf());
  });

  return Array.from(grouped.entries())
    .map(([key, count]) => {
      const [date, type] = key.split('__');
      return { date, type, count, sortValue: bucketValues.get(date) ?? 0 };
    })
    .sort((a, b) => a.sortValue - b.sortValue);
}

export function buildEngagementData(records: TweetRecord[]) {
  return [
    {
      metric: '评论',
      total: records.reduce((sum, record) => sum + record.commentCount, 0),
    },
    {
      metric: '转推',
      total: records.reduce((sum, record) => sum + record.rtCount, 0),
    },
    {
      metric: '点赞',
      total: records.reduce((sum, record) => sum + record.likeCount, 0),
    },
  ];
}

export function buildSummary(records: TweetRecord[]) {
  const totals = buildEngagementData(records);
  return {
    totalTweets: records.length,
    totalComments: totals.find((item) => item.metric === '评论')?.total ?? 0,
    totalRetweets: totals.find((item) => item.metric === '转推')?.total ?? 0,
    totalLikes: totals.find((item) => item.metric === '点赞')?.total ?? 0,
  };
}
