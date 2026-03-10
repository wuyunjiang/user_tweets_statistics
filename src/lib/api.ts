import type { ScrapeJobStartResponse, ScrapeProgressEvent, ScrapeStatus } from '../types';
import { normalizeUsername } from './tweets';

interface FetchTweetParams {
  username: string;
  startDate: string;
}

interface StartScrapeResponse {
  jobId?: string;
  error?: string;
}

export async function startScrapeJob({ username, startDate }: FetchTweetParams) {
  const response = await fetch('/api/scrape/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: normalizeUsername(username),
      startDate,
    }),
  });

  const result = (await response.json()) as StartScrapeResponse;
  if (!response.ok) {
    throw new Error(result.error ?? `请求失败：${response.status}`);
  }
  if (!result.jobId) {
    throw new Error('任务启动失败：缺少 jobId');
  }
  return result as ScrapeJobStartResponse;
}

export async function fetchScrapeStatus() {
  const response = await fetch('/api/status');
  if (!response.ok) {
    throw new Error(`状态请求失败：${response.status}`);
  }
  return (await response.json()) as ScrapeStatus;
}

export function connectScrapeJob(
  jobId: string,
  handlers: {
    onMessage: (event: ScrapeProgressEvent) => void;
    onError: () => void;
  },
) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//127.0.0.1:8787/api/scrape/ws?jobId=${encodeURIComponent(jobId)}`);

  socket.onmessage = (messageEvent) => {
    try {
      handlers.onMessage(JSON.parse(String(messageEvent.data)) as ScrapeProgressEvent);
    } catch {
      handlers.onError();
    }
  };

  socket.onerror = () => {
    handlers.onError();
  };

  return socket;
}
