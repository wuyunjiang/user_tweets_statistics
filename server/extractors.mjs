import dayjs from 'dayjs';

function getInstructionList(payload) {
  return (
    payload?.data?.user?.result?.timeline?.timeline?.instructions ??
    payload?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
    payload?.data?.threaded_conversation_with_injections_v2?.instructions ??
    []
  );
}

function unwrapTweetResult(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const typename = result.__typename;
  if (typename === 'TweetWithVisibilityResults' || typename === 'TweetUnavailable') {
    return unwrapTweetResult(result.tweet ?? result.tweetResult ?? result.result);
  }

  return result;
}

function getNestedText(result) {
  return (
    result?.note_tweet?.note_tweet_results?.result?.text ??
    result?.legacy?.full_text ??
    result?.full_text ??
    ''
  );
}

function mapTweet(result, options = {}) {
  const normalized = unwrapTweetResult(result);
  const legacy = normalized?.legacy;
  const restId = normalized?.rest_id;
  if (!restId || !legacy?.created_at) {
    return null;
  }

  const userResult = normalized?.core?.user_results?.result;
  const userLegacy = userResult?.legacy;
  const text = getNestedText(normalized);

  return {
    id: restId,
    text,
    createdAt: dayjs(legacy.created_at).toISOString(),
    retweetCount: legacy.retweet_count ?? 0,
    favoriteCount: legacy.favorite_count ?? 0,
    replyCount: legacy.reply_count ?? 0,
    quoteCount: legacy.quote_count ?? 0,
    userScreenName: userLegacy?.screen_name,
    userName: userLegacy?.name,
    userIdStr: userResult?.rest_id,
    conversationId: legacy.conversation_id_str,
    language: legacy.lang,
    isQuote: Boolean(legacy.is_quote_status),
    isReply: Boolean(legacy.in_reply_to_status_id_str),
    isRetweet: Boolean(normalized?.retweeted_status_result) || text.startsWith('RT @'),
    isPinned: Boolean(options.isPinned),
    urls: legacy.entities?.urls?.map((item) => ({
      url: item.url,
      expandedUrl: item.expanded_url,
      displayUrl: item.display_url,
    })),
    media:
      legacy.extended_entities?.media?.map((item) => ({
        type: item.type,
        mediaUrl: item.media_url_https ?? item.media_url,
      })) ?? [],
  };
}

function getEntriesFromInstruction(instruction) {
  if (Array.isArray(instruction?.entries)) {
    return instruction.entries;
  }
  if (instruction?.entry) {
    return [instruction.entry];
  }
  return [];
}

function getTweetFromEntry(entry, options = {}) {
  const content = entry?.content;
  if (!content || content.__typename !== 'TimelineTimelineItem') {
    return null;
  }
  if (content.itemContent?.promotedMetadata) {
    return null;
  }

  return mapTweet(content.itemContent?.tweet_results?.result, options);
}

function getTweetsFromModuleEntry(entry) {
  const content = entry?.content;
  if (!content || content.__typename !== 'TimelineTimelineModule') {
    return [];
  }

  const items = content.items ?? [];
  return items
    .map((item) => mapTweet(item?.item?.itemContent?.tweet_results?.result))
    .filter(Boolean);
}

export function extractTimelinePage(payload) {
  const instructions = getInstructionList(payload);
  const tweetsById = new Map();
  let topCursor = null;
  let bottomCursor = null;

  for (const instruction of instructions) {
    if (instruction?.type === 'TimelinePinEntry' && instruction?.entry) {
      const tweet = getTweetFromEntry(instruction.entry, { isPinned: true });
      if (tweet) {
        tweetsById.set(tweet.id, tweet);
      }
      continue;
    }

    for (const entry of getEntriesFromInstruction(instruction)) {
      const content = entry?.content;
      if (!content) {
        continue;
      }

      if (content.__typename === 'TimelineTimelineCursor') {
        if (content.cursorType === 'Top') {
          topCursor = content.value ?? topCursor;
        }
        if (content.cursorType === 'Bottom') {
          bottomCursor = content.value ?? bottomCursor;
        }
        continue;
      }

      const tweet = getTweetFromEntry(entry);
      if (tweet) {
        tweetsById.set(tweet.id, tweet);
      }

      for (const moduleTweet of getTweetsFromModuleEntry(entry)) {
        tweetsById.set(moduleTweet.id, moduleTweet);
      }
    }
  }

  const tweets = Array.from(tweetsById.values()).sort(
    (left, right) => dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf(),
  );

  return {
    tweets,
    topCursor,
    bottomCursor,
  };
}

export function extractTweetsFromResponse(payload) {
  return extractTimelinePage(payload).tweets;
}

export function shouldStopCollecting(records, startDate, cursor, stagnantRounds, maxStagnantRounds = 4) {
  if (!cursor) {
    return true;
  }
  if (stagnantRounds >= maxStagnantRounds) {
    return true;
  }
  if (!records.length) {
    return false;
  }

  const threshold = dayjs(startDate);
  const oldestRecord = records.reduce((oldest, record) =>
    dayjs(record.createdAt).isBefore(dayjs(oldest.createdAt)) ? record : oldest,
  );

  return dayjs(oldestRecord.createdAt).isBefore(threshold);
}

export function filterTweetsByDate(records, startDate) {
  const threshold = dayjs(startDate);
  const now = dayjs();
  return records.filter((record) => {
    const createdAt = dayjs(record.createdAt);
    return (createdAt.isAfter(threshold) || createdAt.isSame(threshold)) && createdAt.isBefore(now.add(1, 'second'));
  });
}
