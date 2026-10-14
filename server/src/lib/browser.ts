import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright";

// One shared browser for the life of the process; a fresh context per task
// keeps pages isolated from each other.
let browser: Browser | null = null;

const LAUNCH_ARGS = ["--disable-dev-shm-usage", "--no-sandbox"];

/** System Chrome locations to try if Playwright's own browser isn't installed. */
function fallbackChromePaths(): string[] {
  return [process.env.CHROME_EXECUTABLE_PATH, "/opt/meta-chromium/chrome"].filter(
    (p): p is string => !!p
  );
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;

  // Preferred: the Chromium Playwright manages itself
  // ("npx playwright install --only-shell chromium").
  try {
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    return browser;
  } catch {
    // Fall back to a system Chrome — needed on machines where the
    // Playwright CDN download is blocked.
    let lastError: unknown = null;
    for (const executablePath of fallbackChromePaths()) {
      try {
        browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS, executablePath });
        return browser;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      "Couldn't launch a browser. Run `npx playwright install --only-shell chromium` " +
        `or set CHROME_EXECUTABLE_PATH. ${lastError instanceof Error ? lastError.message : ""}`
    );
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

/**
 * Creates an isolated context, honoring the standard HTTP(S)_PROXY / NO_PROXY
 * env vars. Playwright doesn't read those itself, and headless Chromium
 * otherwise has no route to the internet on proxied networks.
 * No proxy env vars → no proxy config (normal direct connection).
 */
export async function newContext(options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const b = await getBrowser();
  const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyServer) return b.newContext(options);
  const parsed = new URL(proxyServer);
  return b.newContext({
    ...options,
    proxy: {
      server: `${parsed.protocol}//${parsed.host}`,
      username: decodeURIComponent(parsed.username) || undefined,
      password: decodeURIComponent(parsed.password) || undefined,
      bypass: process.env.NO_PROXY,
    },
  });
}
