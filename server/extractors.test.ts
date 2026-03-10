import { describe, expect, it } from 'vitest';
import { extractTimelinePage, extractTweetsFromResponse, filterTweetsByDate, shouldStopCollecting } from './extractors.mjs';

describe('extractors', () => {
  it('extracts tweets and bottom cursor from timeline payloads', () => {
    const page = extractTimelinePage({
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelinePinEntry',
                    entry: {
                      content: {
                        __typename: 'TimelineTimelineItem',
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: 'pin-1',
                              legacy: {
                                created_at: 'Mon Mar 09 09:00:00 +0000 2026',
                                full_text: 'pinned',
                              },
                              core: {
                                user_results: {
                                  result: {
                                    rest_id: 'u1',
                                    legacy: {
                                      screen_name: 'elonmusk',
                                      name: 'Elon Musk',
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      {
                        content: {
                          __typename: 'TimelineTimelineItem',
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: '1',
                                legacy: {
                                  created_at: 'Mon Mar 09 08:00:00 +0000 2026',
                                  full_text: 'hello world',
                                  reply_count: 2,
                                  retweet_count: 3,
                                  favorite_count: 4,
                                  quote_count: 1,
                                },
                                core: {
                                  user_results: {
                                    result: {
                                      rest_id: 'u1',
                                      legacy: {
                                        screen_name: 'elonmusk',
                                        name: 'Elon Musk',
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          __typename: 'TimelineTimelineItem',
                          itemContent: {
                            promotedMetadata: {
                              advertiser_results: {},
                            },
                            tweet_results: {
                              result: {
                                rest_id: 'ad-1',
                                legacy: {
                                  created_at: 'Mon Mar 09 07:00:00 +0000 2026',
                                  full_text: 'ad',
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          __typename: 'TimelineTimelineCursor',
                          cursorType: 'Bottom',
                          value: 'bottom-cursor',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(page.bottomCursor).toBe('bottom-cursor');
    expect(page.tweets).toHaveLength(2);
    expect(page.tweets[0]).toMatchObject({
      id: 'pin-1',
      isPinned: true,
    });
    expect(page.tweets[1]).toMatchObject({
      id: '1',
      text: 'hello world',
      userScreenName: 'elonmusk',
      replyCount: 2,
      retweetCount: 3,
      favoriteCount: 4,
    });
  });

  it('unwraps visibility wrappers in nested graphql payloads', () => {
    const records = extractTweetsFromResponse({
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      {
                        content: {
                          __typename: 'TimelineTimelineItem',
                          itemContent: {
                            tweet_results: {
                              result: {
                                __typename: 'TweetWithVisibilityResults',
                                tweet: {
                                  rest_id: '1',
                                  legacy: {
                                    created_at: 'Mon Mar 09 08:00:00 +0000 2026',
                                    full_text: 'wrapped',
                                  },
                                  core: {
                                    user_results: {
                                      result: {
                                        rest_id: 'u1',
                                        legacy: {
                                          screen_name: 'elonmusk',
                                          name: 'Elon Musk',
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: '1',
      text: 'wrapped',
    });
  });

  it('extracts tweets from timeline modules', () => {
    const page = extractTimelinePage({
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      {
                        content: {
                          __typename: 'TimelineTimelineModule',
                          items: [
                            {
                              item: {
                                itemContent: {
                                  tweet_results: {
                                    result: {
                                      rest_id: 'module-1',
                                      legacy: {
                                        created_at: 'Mon Mar 09 08:00:00 +0000 2026',
                                        full_text: 'inside module',
                                      },
                                      core: {
                                        user_results: {
                                          result: {
                                            rest_id: 'u1',
                                            legacy: {
                                              screen_name: 'elonmusk',
                                              name: 'Elon Musk',
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });

    expect(page.tweets).toHaveLength(1);
    expect(page.tweets[0]).toMatchObject({
      id: 'module-1',
      text: 'inside module',
    });
  });

  it('stops collecting when the oldest tweet crosses the threshold, no cursor remains, or rounds stagnate', () => {
    expect(
      shouldStopCollecting(
        [
          { id: '0', createdAt: '2026-03-08T01:00:00.000Z' },
          { id: '1', createdAt: '2026-03-08T00:59:59.000Z' },
        ],
        '2026-03-08 09:00:00',
        'cursor',
        0,
      ),
    ).toBe(true);
    expect(shouldStopCollecting([], '2026-03-08 09:00:00', null, 0)).toBe(true);
    expect(shouldStopCollecting([], '2026-03-08 09:00:00', 'cursor', 4)).toBe(true);
    expect(shouldStopCollecting([], '2026-03-08 09:00:00', 'cursor', 1)).toBe(false);
  });

  it('filters records to the requested date range', () => {
    const filtered = filterTweetsByDate(
      [
        { id: '1', createdAt: '2026-03-08T12:00:00.000Z' },
        { id: '2', createdAt: '2026-03-08T08:00:00.000Z' },
        { id: '3', createdAt: '2026-03-08T07:59:59.000Z' },
      ],
      '2026-03-08 16:00:00',
    );
    expect(filtered.map((item) => item.id)).toEqual(['1', '2']);
  });
});
