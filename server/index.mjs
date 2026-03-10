import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { getBrowserStatus } from './browser.mjs';
import { scrapeUserTweets } from './scraper.mjs';

const PORT = Number(process.env.SCRAPER_PORT ?? 8787);
const jobs = new Map();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function createWebSocketFrame(payload) {
  const message = Buffer.from(payload);
  const length = message.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), message]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, message]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, message]);
}

function getOrCreateJob(jobId) {
  if (!jobs.has(jobId)) {
    jobs.set(jobId, {
      sockets: new Set(),
      lastEvent: null,
    });
  }
  return jobs.get(jobId);
}

function broadcastJobEvent(jobId, event) {
  const job = getOrCreateJob(jobId);
  const payload = JSON.stringify(event);
  job.lastEvent = payload;
  const frame = createWebSocketFrame(payload);
  for (const socket of job.sockets) {
    socket.write(frame);
  }
}

function cleanupJob(jobId, delayMs = 5 * 60 * 1000) {
  setTimeout(() => {
    const job = jobs.get(jobId);
    if (job && job.sockets.size === 0) {
      jobs.delete(jobId);
    }
  }, delayMs);
}

async function startScrapeJob({ username, startDate, jobId }) {
  broadcastJobEvent(jobId, {
    jobId,
    phase: 'queued',
    message: '任务已创建，等待抓取',
    responseCount: 0,
    collectedCount: 0,
    oldestCreatedAt: null,
    newestCreatedAt: null,
    checkpointCreatedAt: null,
    records: [],
  });

  try {
    await scrapeUserTweets({
      username,
      startDate,
      jobId,
      onProgress: (event) => broadcastJobEvent(jobId, event),
    });
    cleanupJob(jobId);
  } catch (error) {
    broadcastJobEvent(jobId, {
      jobId,
      phase: 'error',
      message: '抓取失败',
      responseCount: 0,
      collectedCount: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
      checkpointCreatedAt: null,
      records: [],
      error: error instanceof Error ? error.message : '抓取失败',
    });
    cleanupJob(jobId);
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !request.method) {
    sendJson(response, 400, { error: '无效请求' });
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    try {
      const status = await getBrowserStatus();
      sendJson(response, 200, status);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : '状态初始化失败' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/scrape/start') {
    try {
      const body = await readJson(request);
      const username = typeof body.username === 'string' ? body.username.trim().replace(/^@+/, '') : '';
      const startDate = typeof body.startDate === 'string' ? body.startDate : '';
      if (!username || !startDate) {
        sendJson(response, 400, { error: 'username 和 startDate 为必填项' });
        return;
      }

      const jobId = crypto.randomUUID();
      void startScrapeJob({ username, startDate, jobId });
      sendJson(response, 202, { jobId });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : '任务启动失败' });
    }
    return;
  }

  sendJson(response, 404, { error: '未找到接口' });
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/api/scrape/ws') {
    socket.destroy();
    return;
  }

  const jobId = url.searchParams.get('jobId');
  const key = request.headers['sec-websocket-key'];
  if (!jobId || !key || Array.isArray(key)) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ].join('\r\n'),
  );

  const job = getOrCreateJob(jobId);
  job.sockets.add(socket);
  if (job.lastEvent) {
    socket.write(createWebSocketFrame(job.lastEvent));
  }

  const cleanup = () => {
    job.sockets.delete(socket);
  };

  socket.on('close', cleanup);
  socket.on('end', cleanup);
  socket.on('error', cleanup);
  socket.on('data', (chunk) => {
    const opcode = chunk[0] & 0x0f;
    if (opcode === 0x8) {
      socket.end();
    }
  });
});

server.listen(PORT, async () => {
  console.log(`Playwright scraper listening on http://127.0.0.1:${PORT}`);
  try {
    const status = await getBrowserStatus();
    console.log(status.loggedIn ? 'X login cookie detected.' : 'Please login in the opened browser window.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
});
