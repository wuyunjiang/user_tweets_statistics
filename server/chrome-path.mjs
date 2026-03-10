import fs from 'node:fs';

const CANDIDATE_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function resolveChromeExecutablePath() {
  const envPath = process.env.CHROME_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidate = CANDIDATE_PATHS.find((path) => fs.existsSync(path));
  if (!candidate) {
    throw new Error(
      '未找到 Chrome/Chromium，可通过 CHROME_EXECUTABLE_PATH 指定浏览器可执行文件路径。',
    );
  }
  return candidate;
}
