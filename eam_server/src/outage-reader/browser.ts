/**
 * A page open in a real (headless) browser. Requests made through it come from
 * inside the page, with the browser's cookies and connection, so a site's
 * firewall sees an ordinary visitor.
 */
export interface BrowserPage {
  /** The page's HTML once it has loaded. */
  html: string;
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}

export type OpenBrowser = (
  url: string,
  options: { userAgent: string; timeoutMs: number },
) => Promise<BrowserPage>;
