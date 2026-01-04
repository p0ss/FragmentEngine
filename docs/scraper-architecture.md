# Scraper Architecture & Operations

This document explains how the unified scraper in `scraper/` discovers pages, extracts fragments, and keeps Typesense in sync.

## Execution Flow

1. **Bootstrap** (`scraper/scraper.js`)
   - Loads config from `config/scraper-config.js` plus env vars such as `CONCURRENCY`, `MAX_DEPTH`, `MAX_LINKS_PER_PAGE`, `TARGET_URLS`, and `PUPPETEER_EXECUTABLE_PATH`.
   - Creates a Typesense client and `ScraperMonitor` to track throughput and error rates.
2. **Schema prep**
   - `prepareCollection()` ensures `content_fragments` and `content_pages` collections exist. Missing fields are patched in place so new deployments can evolve schemas without manual migrations.
3. **Browser launch**
   - Starts headless Chromium via Puppeteer with hardened flags (`--no-sandbox`, `--disable-dev-shm-usage`, fallback `--single-process`). Launch attempts are wrapped in timeouts to detect stuck Chrome instances early.
4. **Site guards**
   - `fetchRobots()` pulls `robots.txt` using `node-fetch` and falls back to full access only if the file cannot be loaded.
   - `fetchSitemapUrls()` seeds the crawl queue with sitemap entries before recursive crawling begins.
5. **Concurrent crawl**
   - `p-limit` caps concurrency (`CONCURRENCY`, default 5). Each URL passes through:
     - depth/duplicate checks (`maxDepth`, `visited` Set)
     - block/priority filters from `excludePatterns` and `priorityPatterns`
     - optional throttling (`crawlDelay`).
6. **Rendering + extraction**
   - Pages render inside Puppeteer to capture hydrated content.
   - DOM is piped through Cheerio, where `extractFragment()` slices each heading/content pair into distinct fragments, preserves HTML, generates hierarchical breadcrumbs, and captures presentation metadata (`scraper/extractors.js`).
   - Reading level, component types, CSS classes, inline styles, and popularity heuristics are calculated up-front so Typesense documents stay query-ready.
7. **Taxonomy enrichment**
   - `taxonomies.js` and `srrs.js` map fragments to life events, categories, states, and stress scores using keyword decks from `data/seed-taxonomies.json`.
8. **Persistence**
   - `indexFragments()` batches fragments into `content_fragments` and updates the derived `content_pages` aggregate (URL-level stats, embeddings, link graphs).
   - `pruneStaleDocs()` removes previous crawl versions so Typesense only serves the most recent snapshot.
9. **Monitoring output**
   - `ScraperMonitor` (`scraper/monitor.js`) records load/extraction timings, errors, and rates; `getReport()` prints the final crawl summary that `deploy.sh` and CI scripts rely on.

## Configuration Summary

| Variable / File | Purpose |
| --- | --- |
| `CONCURRENCY` | Max concurrent page fetches (defaults to 5). |
| `MAX_DEPTH`, `MAX_LINKS_PER_PAGE` | Crawl boundaries enforced in `config/scraper-config.js`. |
| `TARGET_URLS` | Comma-separated seed list when running via `docker-compose run scraper`. |
| `PUPPETEER_EXECUTABLE_PATH` | Custom Chrome/Chromium binary path if the default bundle is unavailable. |
| `config/scraper-config.js` | Content selectors, exclusion rules, crawl delay, and total page ceiling (`maxPages`). |
| `data/seed-taxonomies.json` | Keyword decks for enrichment and SRRS weightings. |
| `.env` | Typesense connection + API key shared with the API layer. |

## Key Modules

- `scraper.js` – orchestrates crawling, Typesense writes, and stale-doc pruning.
- `extractors.js` – normalises headings, builds fragment IDs, captures styles/classes, and computes heuristics such as reading level or `component_type`.
- `taxonomies.js` / `srrs.js` – attaches structured metadata (life events, eligibility hints, stress scores).
- `monitor.js` – live KPIs surfaced at the end of a crawl.
- `multi-scrape.js` – helper to spin through multiple domains sequentially; used by `deploy.sh --crawl`.

## Operational Tips

- When Chromium repeatedly fails to launch, set `PUPPETEER_EXECUTABLE_PATH` to a system Chrome binary and confirm the `--no-sandbox` flags are allowed in your environment.
- To throttle aggressive sites, raise `crawlDelay` or lower `CONCURRENCY`. Both values are hot-reload friendly when passed via environment variables.
- Always rerun `indexFragments()` (e.g., re-run `deploy.sh --crawl`) after editing `config/typesense-schema.js` so missing fields are patched automatically.
