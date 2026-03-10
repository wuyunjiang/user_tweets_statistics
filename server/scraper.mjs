import dayjs from 'dayjs';
import { getBrowserContext } from './browser.mjs';
import { extractTimelinePage, filterTweetsByDate, shouldStopCollecting } from './extractors.mjs';

const TIMELINE_PATHS = ['/UserTweets', '/UserTweetsAndReplies'];

function isTargetTimelineUrl(url) {
  return TIMELINE_PATHS.some((path) => url.includes(path));
}

function parseTimelineRequest(request) {
  const url = new URL(request.url());
  if (!isTargetTimelineUrl(url.pathname)) {
    return null;
  }

  const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
  if (!variables.userId) {
    return null;
  }

  return {
    userId: variables.userId,
    cursor: typeof variables.cursor === 'string' ? variables.cursor : null,
    count: Number(variables.count ?? 20),
    pathname: url.pathname,
  };
}

function buildProgressEvent(jobId, phase, message, responseCount, records, checkpointCreatedAt, error) {
  const sortedRecords = [...records].sort((left, right) => dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf());
  return {
    jobId,
    phase,
    message,
    responseCount,
    collectedCount: sortedRecords.length,
    newestCreatedAt: sortedRecords[0]?.createdAt ?? null,
    oldestCreatedAt: sortedRecords[sortedRecords.length - 1]?.createdAt ?? null,
    checkpointCreatedAt: checkpointCreatedAt ?? null,
    records: sortedRecords,
    error,
  };
}

async function collectTweetsForUser(page, username, startDate, options = {}) {
  const { jobId = 'direct', onProgress } = options;
  const tweetsById = new Map();
  const threshold = dayjs(startDate).toISOString();
  const normalizedUsername = username.toLowerCase();

  let targetUserId = null;
  let latestBottomCursor = null;
  let latestRequestCursor = null;
  let seenTimelineResponse = false;
  let responseCount = 0;
  let latestMatchedPageOldestCreatedAt = null;

  const emitProgress = (phase, message, error) => {
    onProgress?.(
      buildProgressEvent(
        jobId,
        phase,
        message,
        responseCount,
        filterTweetsByDate(Array.from(tweetsById.values()), threshold),
        latestMatchedPageOldestCreatedAt,
        error,
      ),
    );
  };

  const responseHandler = async (response) => {
    if (!isTargetTimelineUrl(response.url())) {
      return;
    }

    const requestMeta = parseTimelineRequest(response.request());
    if (!requestMeta) {
      return;
    }

    try {
      const payload = await response.json();
      const pageData = extractTimelinePage(payload);
      responseCount += 1;
      seenTimelineResponse = true;
      targetUserId ??= requestMeta.userId;
      latestRequestCursor = requestMeta.cursor;
      if (pageData.bottomCursor) {
        latestBottomCursor = pageData.bottomCursor;
      }

      let acceptedCount = 0;
      const acceptedTweets = [];
      for (const tweet of pageData.tweets) {
        const matchesUser =
          !tweet.isPinned &&
          (tweet.userIdStr === targetUserId || tweet.userScreenName?.toLowerCase() === normalizedUsername);
        if (matchesUser) {
          tweetsById.set(tweet.id, tweet);
          acceptedTweets.push(tweet);
          acceptedCount += 1;
        }
      }

      if (acceptedTweets.length) {
        acceptedTweets.sort((left, right) => dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf());
        latestMatchedPageOldestCreatedAt = acceptedTweets[acceptedTweets.length - 1].createdAt;
      }

      console.log(
        `[scrape] response user=${username} requestCursor=${requestMeta.cursor ? 'yes' : 'no'} bottomCursor=${pageData.bottomCursor ? 'yes' : 'no'} pageTweets=${pageData.tweets.length} accepted=${acceptedCount} collected=${tweetsById.size} checkpoint=${latestMatchedPageOldestCreatedAt ?? 'none'}`,
      );
      emitProgress('running', `已监听到 ${responseCount} 次接口响应，当前收集 ${tweetsById.size} 条`);
    } catch (error) {
      console.log(
        `[scrape] response parse failed user=${username} message=${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  };

  page.on('response', responseHandler);

  try {
    emitProgress('queued', '准备打开用户主页');
    await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    let stagnantRounds = 0;
    let previousCount = tweetsById.size;
    let previousBottomCursor = latestBottomCursor;

    for (let round = 0; round < 180; round += 1) {
      const reachedTarget =
        latestMatchedPageOldestCreatedAt && dayjs(latestMatchedPageOldestCreatedAt).isBefore(dayjs(threshold));
      const noMorePages = !latestBottomCursor && !latestRequestCursor;

      if (
        seenTimelineResponse &&
        (reachedTarget || noMorePages || shouldStopCollecting([], threshold, latestBottomCursor ?? latestRequestCursor, stagnantRounds, 8))
      ) {
        console.log(
          `[scrape] stop user=${username} round=${round} collected=${tweetsById.size} stagnantRounds=${stagnantRounds} latestBottomCursor=${latestBottomCursor ? 'yes' : 'no'} checkpoint=${latestMatchedPageOldestCreatedAt ?? 'none'}`,
        );
        break;
      }

      await page.mouse.wheel(0, 4200);
      await page.waitForTimeout(1200);

      const nextCount = tweetsById.size;
      const cursorChanged = previousBottomCursor !== latestBottomCursor;
      stagnantRounds = nextCount === previousCount && !cursorChanged ? stagnantRounds + 1 : 0;
      previousCount = nextCount;
      previousBottomCursor = latestBottomCursor;

      if (!seenTimelineResponse && round >= 10) {
        throw new Error('未监听到用户时间线接口响应，请确认当前账号可以访问该用户主页。');
      }
    }

    console.log(`[scrape] finish user=${username} collected=${tweetsById.size}`);
    const records = filterTweetsByDate(Array.from(tweetsById.values()), threshold);
    onProgress?.(
      buildProgressEvent(jobId, 'done', `抓取完成，共 ${records.length} 条`, responseCount, records, latestMatchedPageOldestCreatedAt),
    );
    return records;
  } finally {
    page.off('response', responseHandler);
  }
}

export async function scrapeUserTweets({ username, startDate, jobId, onProgress }) {
  const context = await getBrowserContext();
  const page = await context.newPage();

  try {
    return await collectTweetsForUser(page, username, startDate, { jobId, onProgress });
  } finally {
    await page.close();
  }
}
