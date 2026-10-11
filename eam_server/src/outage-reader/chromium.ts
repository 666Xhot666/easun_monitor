import type { OpenBrowser } from './browser';
import { SiteError } from './dnem/site-error';

interface PlaywrightModule {
  chromium: {
    launch(options: { headless: boolean }): Promise<PwBrowser>;
  };
}

interface PwBrowser {
  newContext(options: {
    userAgent: string;
    locale: string;
    timezoneId: string;
  }): Promise<PwContext>;
  close(): Promise<void>;
}

interface PwContext {
  newPage(): Promise<PwPage>;
}

interface PwPage {
  goto(
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options: { state: 'attached'; timeout: number },
  ): Promise<unknown>;
  content(): Promise<string>;
  evaluate<R, A>(fn: (arg: A) => Promise<R>, arg: A): Promise<R>;
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  const name = 'playwright';
  try {
    const mod = (await import(name)) as {
      default?: PlaywrightModule;
    } & PlaywrightModule;
    return mod.default ?? mod;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Playwright could not be loaded (run \`npm install playwright\` and \`npx playwright install chromium\` in eam_server): ${message}`,
    );
  }
}

export const openInChromium: OpenBrowser = async (
  url,
  { userAgent, timeoutMs },
) => {
  const playwright = await loadPlaywright();

  let browser: PwBrowser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Chromium did not start (run \`npx playwright install chromium\` in eam_server): ${message}`,
    );
  }

  try {
    const context = await browser.newContext({
      userAgent,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SiteError(
        'network',
        `The browser could not load ${url}: ${message}`,
      );
    }

    // a firewall check reloads into the real page; its CSRF token marks the real page
    try {
      await page.waitForSelector('meta[name="csrf-token"]', {
        state: 'attached',
        timeout: timeoutMs,
      });
    } catch {
      /* not past the check: the caller sees it in the HTML */
    }

    const html = await page.content();

    const post = async (
      postUrl: string,
      body: string,
      headers: Record<string, string>,
    ): Promise<{ status: number; body: string }> => {
      try {
        return await page.evaluate(
          async (arg: {
            postUrl: string;
            body: string;
            headers: Record<string, string>;
          }) => {
            const response = await fetch(arg.postUrl, {
              method: 'POST',
              body: arg.body,
              headers: arg.headers,
              credentials: 'same-origin',
            });
            return { status: response.status, body: await response.text() };
          },
          { postUrl, body, headers },
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new SiteError(
          'network',
          `The request from the browser failed: ${message}`,
        );
      }
    };

    const close = (): Promise<void> => browser.close();

    return { html, post, close };
  } catch (e) {
    await browser.close();
    throw e;
  }
};
