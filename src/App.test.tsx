import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import App from './App';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {}

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

vi.mock('@ant-design/charts', () => ({
  Pie: () => <div data-testid="pie-chart" />,
  Line: () => <div data-testid="line-chart" />,
  Column: () => <div data-testid="column-chart" />,
}));

function renderApp() {
  return render(
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>,
  );
}

function mockFetchSequence(handlers: Array<(input: RequestInfo | URL, init?: RequestInit) => Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const handler = handlers.shift();
    if (!handler) {
      throw new Error('unexpected fetch');
    }
    return handler(input, init);
  });
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  it('renders cached snapshot from localStorage', async () => {
    localStorage.setItem(
      'twitter-stats-snapshot',
      JSON.stringify({
        query: {
          username: '@elonmusk',
          startDate: '2026-03-01',
        },
        savedAt: '2026-03-08T06:00:00.000Z',
        records: [
          {
            id: '1',
            text: 'Hello world',
            url: 'https://x.com/elonmusk/status/1',
            type: '纯文本发帖',
            createdAt: '2026-03-08T06:00:00.000Z',
            createdLabel: '2026-03-08 14:00:00',
            commentCount: 2,
            rtCount: 3,
            likeCount: 4,
          },
        ],
      }),
    );
    mockFetchSequence([
      () =>
        new Response(
          JSON.stringify({
            browserReady: true,
            loggedIn: true,
            profilePath: '/tmp/x-profile',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ]);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Playwright 服务已登录 X 账号')).toBeInTheDocument();
    });
    expect(screen.getByText('推文统计面板')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('推文总数')).toBeInTheDocument();
    expect(screen.getAllByText('纯文本发帖').length).toBeGreaterThan(0);
  });

  it('submits the form, stores query, and renders fetched tweets', async () => {
    const user = userEvent.setup();
    mockFetchSequence([
      () =>
        new Response(
          JSON.stringify({
            browserReady: true,
            loggedIn: true,
            profilePath: '/tmp/x-profile',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      () =>
        new Response(
          JSON.stringify({
            jobId: 'job-1',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        ),
    ]);

    renderApp();

    await user.type(screen.getByLabelText('推特用户名'), '@elonmusk');
    await user.click(screen.getByRole('button', { name: '开始统计' }));

    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      MockWebSocket.instances[0].emitMessage({
        jobId: 'job-1',
        phase: 'running',
        responseCount: 2,
        collectedCount: 1,
        oldestCreatedAt: '2026-03-08T00:00:00.000Z',
        newestCreatedAt: '2026-03-08T00:00:00.000Z',
        records: [
          {
            id: 'tweet-1',
            text: 'Check this out https://x.com/foo/status/1',
            createdAt: '2026-03-08T00:00:00.000Z',
            retweetCount: 10,
            favoriteCount: 30,
            replyCount: 4,
            urls: [{ url: 'https://x.com/foo/status/1' }],
            isQuote: true,
          },
        ],
      });
      MockWebSocket.instances[0].emitMessage({
        jobId: 'job-1',
        phase: 'done',
        responseCount: 3,
        collectedCount: 1,
        oldestCreatedAt: '2026-03-08T00:00:00.000Z',
        newestCreatedAt: '2026-03-08T00:00:00.000Z',
        records: [
          {
            id: 'tweet-1',
            text: 'Check this out https://x.com/foo/status/1',
            createdAt: '2026-03-08T00:00:00.000Z',
            retweetCount: 10,
            favoriteCount: 30,
            replyCount: 4,
            urls: [{ url: 'https://x.com/foo/status/1' }],
            isQuote: true,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('引用推文').length).toBeGreaterThan(0);
      expect(screen.getByText(/已获取 1 条推文/)).toBeInTheDocument();
    });

    const storedQuery = JSON.parse(localStorage.getItem('twitter-stats-query') ?? '{}');
    expect(storedQuery.username).toBe('@elonmusk');
    expect(storedQuery.startDate).toBeTruthy();

    const storedSnapshot = JSON.parse(localStorage.getItem('twitter-stats-snapshot') ?? '{}');
    expect(storedSnapshot.records).toHaveLength(1);
    expect(storedSnapshot.records[0].type).toBe('引用推文');
  });

  it('shows an error banner when request fails', async () => {
    const user = userEvent.setup();
    mockFetchSequence([
      () =>
        new Response(
          JSON.stringify({
            browserReady: true,
            loggedIn: false,
            profilePath: '/tmp/x-profile',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      () =>
        new Response(JSON.stringify({ jobId: 'job-2' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
    ]);

    renderApp();

    await user.type(screen.getByLabelText('推特用户名'), '@elonmusk');
    await user.click(screen.getByRole('button', { name: '开始统计' }));
    act(() => {
      MockWebSocket.instances[0].emitMessage({
        jobId: 'job-2',
        phase: 'error',
        responseCount: 1,
        collectedCount: 0,
        oldestCreatedAt: null,
        newestCreatedAt: null,
        records: [],
        error: '抓取失败',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('请求失败')).toBeInTheDocument();
      expect(screen.getByText('抓取失败')).toBeInTheDocument();
    });
  });
});
