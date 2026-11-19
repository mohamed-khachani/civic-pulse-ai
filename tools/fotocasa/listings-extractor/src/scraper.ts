
import puppeteer, {
  type Browser,
  type Page,
  type HTTPResponse,
} from "puppeteer";

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

interface ScraperConfig {
  readonly baseUrl: string;
  readonly totalPages: number;
  readonly outputDir: string;
  readonly navigationTimeoutMs: number;
  readonly renderDelayMs: number;
  readonly requestDelayMs: number;
  readonly maxRetries: number;
  readonly minHtmlLength: number;
}

interface ScrapeResult {
  readonly pageNumber: number;
  readonly url: string;
  readonly success: boolean;
  readonly filePath?: string;
  readonly htmlBytes?: number;
  readonly error?: string;
}

const CONFIG: ScraperConfig = {
  baseUrl:
    "https://www.fotocasa.es/en/rental/homes/madrid-capital/all-zones/l",
  totalPages: 263,
  outputDir: path.resolve("html"),
  navigationTimeoutMs: 60_000,
  renderDelayMs: 2_000,
  requestDelayMs: 3_000,
  maxRetries: 3,
  minHtmlLength: 5_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(pageNumber: number): string {
  return pageNumber === 1
    ? CONFIG.baseUrl
    : `${CONFIG.baseUrl}/${pageNumber}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scrollPage(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    const step: number = 600;

    for (
      let y = 0;
      y < document.body.scrollHeight;
      y += step
    ) {
      window.scrollTo(0, y);

      await new Promise<void>((resolve) =>
        setTimeout(resolve, 200)
      );
    }

    window.scrollTo(0, 0);
  });
}

async function scrapePage(
  page: Page,
  pageNumber: number
): Promise<ScrapeResult> {
  const url: string = buildUrl(pageNumber);
  const filePath: string = path.join(
    CONFIG.outputDir,
    `page_${pageNumber}.html`
  );

  if (await fileExists(filePath)) {
    console.log(`[${pageNumber}] Already downloaded`);

    return {
      pageNumber,
      url,
      success: true,
      filePath,
    };
  }

  for (
    let attempt = 1;
    attempt <= CONFIG.maxRetries;
    attempt++
  ) {
    try {
      console.log(
        `[${pageNumber}/${CONFIG.totalPages}] Attempt ${attempt}`
      );

      const response: HTTPResponse | null = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.navigationTimeoutMs,
      });

      if (response === null) {
        throw new Error("No HTTP response received");
      }

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }

      await sleep(CONFIG.renderDelayMs);

      await scrollPage(page);

      await sleep(1_000);

      const html: string = await page.content();
      const htmlBytes: number = Buffer.byteLength(
        html,
        "utf8"
      );

      if (htmlBytes < CONFIG.minHtmlLength) {
        throw new Error(
          `HTML too small: ${htmlBytes} bytes`
        );
      }

      await writeFile(filePath, html, "utf8");

      console.log(
        `[${pageNumber}] Saved ${htmlBytes} bytes`
      );

      return {
        pageNumber,
        url,
        success: true,
        filePath,
        htmlBytes,
      };
    } catch (error: unknown) {
      const message: string =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `[${pageNumber}] Attempt ${attempt} failed: ${message}`
      );

      if (attempt === CONFIG.maxRetries) {
        return {
          pageNumber,
          url,
          success: false,
          error: message,
        };
      }

      await sleep(CONFIG.requestDelayMs * attempt);
    }
  }

  throw new Error("Unreachable retry state");
}

async function main(): Promise<void> {
  await mkdir(CONFIG.outputDir, { recursive: true });

  const browser: Browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1440,
      height: 900,
    },
  });

  const results: ScrapeResult[] = [];

  try {
    const page: Page = await browser.newPage();

    page.setDefaultNavigationTimeout(
      CONFIG.navigationTimeoutMs
    );

    for (
      let pageNumber = 1;
      pageNumber <= CONFIG.totalPages;
      pageNumber++
    ) {
      const result: ScrapeResult = await scrapePage(
        page,
        pageNumber
      );

      results.push(result);

      await sleep(CONFIG.requestDelayMs);
    }
  } finally {
    await browser.close();
  }

  const successful: number = results.filter(
    (result) => result.success
  ).length;

  const failed: number = results.length - successful;

  console.log("\nScraping finished");
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);

  await writeFile(
    path.join(CONFIG.outputDir, "results.json"),
    JSON.stringify(results, null, 2),
    "utf8"
  );
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
