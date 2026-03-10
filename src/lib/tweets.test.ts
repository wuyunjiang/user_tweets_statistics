import {
  buildEngagementData,
  buildTimelineData,
  buildTypeChartData,
  classifyTweet,
  mapTweets,
  normalizeUsername,
} from './tweets';
import type { ApiTweet } from '../types';

describe('tweet helpers', () => {
  it('normalizes usernames', () => {
    expect(normalizeUsername('@elonmusk')).toBe('elonmusk');
    expect(normalizeUsername('  @@jack  ')).toBe('jack');
  });

  it('classifies tweet types by available signals', () => {
    const cases: Array<[ApiTweet, string]> = [
      [{ id: '1', createdAt: '2026-03-08T00:00:00.000Z', text: 'RT @foo hello' }, '转推推文'],
      [{ id: '2', createdAt: '2026-03-08T00:00:00.000Z', text: 'quoted', isQuote: true }, '引用推文'],
      [{ id: '3', createdAt: '2026-03-08T00:00:00.000Z', text: 'poll', poll: {} }, '投票推文'],
      [{ id: '4', createdAt: '2026-03-08T00:00:00.000Z', text: 'Join my x.com/i/spaces/123' }, '空间分享推文'],
      [{ id: '5', createdAt: '2026-03-08T00:00:00.000Z', text: '1/4 shipping thread' }, '推文串/连推 (Threads)'],
      [{ id: '6', createdAt: '2026-03-08T00:00:00.000Z', text: 'article', urls: [{ displayUrl: 'x.com/i/articles/42' }] }, '文章'],
      [{ id: '7', createdAt: '2026-03-08T00:00:00.000Z', text: 'photo', media: [{ type: 'photo' }] }, '多媒体发帖'],
      [{ id: '8', createdAt: '2026-03-08T00:00:00.000Z', text: 'visit https://example.com' }, '链接推文'],
      [{ id: '9', createdAt: '2026-03-08T00:00:00.000Z', text: 'plain text' }, '纯文本发帖'],
      [{ id: '10', createdAt: '2026-03-08T00:00:00.000Z' }, '其他'],
    ];

    cases.forEach(([tweet, expected]) => {
      expect(classifyTweet(tweet)).toBe(expected);
    });
  });

  it('maps and aggregates tweet data', () => {
    const mapped = mapTweets([
      {
        id: '1',
        text: 'hello',
        createdAt: '2026-03-08T01:00:00.000Z',
        replyCount: 2,
        retweetCount: 3,
        favoriteCount: 4,
      },
      {
        id: '2',
        text: 'look https://example.com',
        createdAt: '2026-03-07T01:00:00.000Z',
        replyCount: 5,
        retweetCount: 6,
        favoriteCount: 7,
      },
    ]);

    expect(mapped[0].id).toBe('1');
    expect(buildTypeChartData(mapped)).toEqual([
      { type: '纯文本发帖', count: 1 },
      { type: '链接推文', count: 1 },
    ]);
    expect(buildTimelineData(mapped, 'day')).toEqual([
      { date: '2026-03-07', count: 1 },
      { date: '2026-03-08', count: 1 },
    ]);
    expect(buildTimelineData(mapped, 'month')).toEqual([
      { date: '2026-03', count: 2 },
    ]);
    expect(buildEngagementData(mapped)).toEqual([
      { metric: '评论', total: 7 },
      { metric: '转推', total: 9 },
      { metric: '点赞', total: 11 },
    ]);
  });
});
