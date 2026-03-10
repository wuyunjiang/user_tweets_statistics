import path from 'node:path';
import { chromium } from 'playwright-core';
import { resolveChromeExecutablePath } from './chrome-path.mjs';

const PROFILE_PATH = path.resolve('.playwright/x-profile');

let contextPromise;

async function createContext() {
  const executablePath = resolveChromeExecutablePath();
  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    executablePath,
    headless: false,
    viewport: { width: 1440, height: 1100 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  return context;
}

export async function getBrowserContext() {
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}

export async function getBrowserStatus() {
  const context = await getBrowserContext();
  const cookies = await context.cookies('https://x.com');
  const loggedIn = cookies.some((cookie) => cookie.name === 'auth_token');
  return {
    browserReady: true,
    loggedIn,
    profilePath: PROFILE_PATH,
  };
}
