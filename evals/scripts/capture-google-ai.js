#!/usr/bin/env node

/**
 * Capture Google Search AI Overview text for one or more queries
 * using a real Chrome instance (headless by default disabled).
 */

const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {
    query: null,
    listFile: null,
    outputDir: path.join(__dirname, '..', 'google-ai-captures'),
    headless: false,
    waitMs: 4500,
    screenshot: false,
    chromePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--query':
      case '-q':
        opts.query = argv[++i];
        break;
      case '--list':
        opts.listFile = argv[++i];
        break;
      case '--output':
      case '-o':
        opts.outputDir = path.resolve(argv[++i]);
        break;
      case '--headless':
        opts.headless = true;
        break;
      case '--wait':
        opts.waitMs = parseInt(argv[++i], 10) || opts.waitMs;
        break;
      case '--screenshot':
        opts.screenshot = true;
        break;
      case '--chrome':
        opts.chromePath = argv[++i];
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.query && !opts.listFile) {
    console.error('Provide either --query "..." or --list queries.txt');
    process.exit(1);
  }

  return opts;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'search';
}

async function loadQueries(opts) {
  if (opts.listFile) {
    const raw = await fs.readFile(path.resolve(opts.listFile), 'utf-8');
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }
  return [opts.query];
}

async function dismissConsent(page) {
  // Google may inject an iframe for consent.
  try {
    const consentFrame = page
      .frames()
      .find(frame => frame.url().includes('consent.google.com'));
    if (consentFrame) {
      const buttons = [
        'button[aria-label="Accept all"]',
        'button[aria-label="I agree"]',
        '#L2AGLb',
        'button[aria-label="Agree to the use of cookies and other data for the purposes described"]'
      ];
      for (const selector of buttons) {
        const btn = await consentFrame.$(selector);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(1500);
          return true;
        }
      }
    }
  } catch (error) {
    console.warn('Consent iframe handling failed:', error.message);
  }

  const selectors = ['#L2AGLb', 'button[aria-label="Accept all"]'];
  for (const selector of selectors) {
    try {
      const button = await page.waitForSelector(selector, { timeout: 2000 });
      if (button) {
        await button.click();
        await page.waitForTimeout(1200);
        return true;
      }
    } catch (_) {}
  }

  try {
    const [button] = await page.$x("//button[contains(., 'I agree')]");
    if (button) {
      await button.click();
      await page.waitForTimeout(1200);
      return true;
    }
  } catch (_) {}
  return false;
}

async function extractAIOverview(page) {
  return await page.evaluate(() => {
    function findContainer() {
      const selectors = [
        'div[aria-label="AI Overview"]',
        'div[data-hveid][aria-label="AI Overview"]',
        'div[data-attrid^="ai_overview"]'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
      }
      const headings = Array.from(document.querySelectorAll('h2, h3, span'));
      const heading = headings.find(el => /AI Overview/i.test(el.textContent || ''));
      if (heading) {
        let current = heading.parentElement;
        for (let i = 0; i < 5 && current; i++) {
          if (current.querySelector('div[aria-label="AI Overview"], div[data-attrid^="ai_overview"]')) {
            return current.querySelector('div[aria-label="AI Overview"], div[data-attrid^="ai_overview"]');
          }
          current = current.parentElement;
        }
      }
      return null;
    }

    const container = findContainer();
    if (!container) return null;

    const text = container.innerText || '';
    const html = container.innerHTML || '';

    const sources = Array.from(container.querySelectorAll('a'))
      .map(link => ({
        title: (link.textContent || '').trim(),
        href: link.href
      }))
      .filter(item => item.href && !item.href.startsWith('javascript'));

    const uniqueSources = [];
    const seen = new Set();
    for (const source of sources) {
      const key = source.href;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueSources.push(source);
    }

    return {
      text,
      html,
      sources: uniqueSources
    };
  });
}

async function captureQuery(browser, query, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 980 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=au`;
  console.log(`\n→ Searching: ${query}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);
  await page.waitForTimeout(opts.waitMs);

  const data = await extractAIOverview(page);

  if (!data || !data.text) {
    console.warn(`⚠️  No AI Overview found for "${query}"`);
  }

  const slug = slugify(query);
  await fs.mkdir(opts.outputDir, { recursive: true });

  if (data?.text) {
    const textPath = path.join(opts.outputDir, `${slug}.txt`);
    await fs.writeFile(textPath, data.text.trim(), 'utf-8');
    console.log(`   Saved text → ${textPath}`);
  }

  const jsonPath = path.join(opts.outputDir, `${slug}.json`);
  await fs.writeFile(jsonPath, JSON.stringify({
    search_term: query,
    search_url: searchUrl,
    captured_at: new Date().toISOString(),
    ai_overview: data
  }, null, 2));
  console.log(`   Saved meta  → ${jsonPath}`);

  if (opts.screenshot) {
    const imagePath = path.join(opts.outputDir, `${slug}.png`);
    await page.screenshot({ path: imagePath, fullPage: true });
    console.log(`   Screenshot  → ${imagePath}`);
  }

  await page.close();
}

async function main() {
  const opts = parseArgs();
  const queries = await loadQueries(opts);
  const launchOptions = {
    headless: opts.headless ? 'new' : false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  };
  if (opts.chromePath) {
    launchOptions.executablePath = opts.chromePath;
  }

  const browser = await puppeteer.launch(launchOptions);

  for (const query of queries) {
    try {
      await captureQuery(browser, query, opts);
    } catch (error) {
      console.error(`❌ Failed to capture "${query}":`, error.message);
    }
  }

  await browser.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
