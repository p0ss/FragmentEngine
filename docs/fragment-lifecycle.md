# Fragment Lifecycle

This repo treats "fragments" as durable, taxonomy-rich slices of authoritative government content. The lifecycle below covers how a crawl source is chosen, how DOM is carved into fragments, what enrichment happens, and how the seed taxonomies flow through Typesense.

## 1. Discovery → candidate selection
1. **Targets** – `scraper/multi-scrape.js` reads `TARGET_URLS` (or defaults to my.gov.au + servicesaustralia.gov.au) and instantiates `MyGovScraper` with `config/scraper-config.js` per domain. Each run stamps a `CRAWL_VERSION` so old docs can be pruned.
2. **Politeness** – The scraper loads `robots.txt` via `node-fetch` and respects disallow rules; rate limiting keeps requests under ~5 RPS.
3. **Seeds from sitemaps** – `fetchSitemapUrls` is called before regular crawling to prioritise canonical URLs when a sitemap exists.
4. **Link gating** – Only same-origin HTML links survive (no PDFs/forms), anchors are dropped, and scores favour service keywords (apply, eligibility, benefit, etc.). Depth, link, and page limits (Config: `maxDepth`, `maxLinksPerPage`, `maxPages`) bound the crawl.

## 2. Fragment extraction
1. **Main content focus** – `scraper.js` looks for `main/#main-content/.main-content/article` and falls back to `<body>` if needed.
2. **Heading-based chunks** – For every `h1–h4`, the scraper gathers the sibling paragraphs/lists/tables until the next heading. Standalone components (alerts, warning boxes, checklists, etc.) are also captured even if they lack headings.
3. **Stable IDs + anchors** – `scraper/extractors.js` hashes `url + heading + content` to create IDs, and anchors prefer the DOM `id` if present. That guarantees dedupe + deterministic updates.
4. **Hierarchy metadata** – Each fragment stores `site_hierarchy`, breadcrumbs, and positional fields (`hierarchy_lvl0–3`) so Typesense facets mirror the page outline.
5. **Preserved markup & UX cues** – The extractor keeps raw HTML, CSS classes, inline/computed styles (for cards, alerts, etc.), component typing (form/table/checklist/alert/video), and lightweight analytics (word count, list count, emphasis).
6. **Quality scores** – Reading level is computed with Flesch-Kincaid via `syllable`; a heuristic `popularity_score` boosts forms, alerts, checklists and medium-length copy; SRRS is computed later for stress-aware ranking.

## 3. Taxonomy enrichment per fragment
1. **Seed data** – `scraper/taxonomies.js` loads `data/seed-taxonomies.json` (keywords, related categories, SRRS weights, stage variants) and `data/lifevents-graph.js` (graph of Australian life events, prerequisites, age ranges, eligibility statuses).
2. **Categories & eligibility** – `detectCategories` matches fragment text/title to taxonomy keywords; eligibility fields (citizenship/residency/disability/employment/housing/etc.) are initialised so downstream filters are always populated (even when empty).
3. **Provider/governance** – `detectProvider` first relies on domain heuristics (`servicesaustralia.gov.au`, `.gov.au` state codes), then on keyword fallbacks (Medicare, Centrelink, etc.) to label `provider` + `governance` facets.
4. **State coverage** – `detectStates` inspects URL structure plus explicit textual cues ("NSW residents", "in Victoria") to decide whether a fragment is national or state-specific.
5. **Structural hints** – Checklists get `task_order`, `has_form`, `has_checklist`, `component_type`, and reading-level facets filled for the UI filters.

## 4. Aggregation to page documents
Fragments belong to a "base URL" (hash/query stripped). After each crawl, `buildPageDocs()` aggregates per page and `buildPageDocsWithLifeEvents()` layers on richer life-event analysis:
- **Lifecycle roll-up** – Each page collects fragment IDs, counts, free-text keywords (top terms), outbound links, and combined taxonomy facets (life events, categories, states, provider, governance).
- **Life event inference** – Page text/title/keywords are compared against taxonomy life-event keywords. The highest scoring event becomes `primary_life_event` and drives downstream UI defaults.
- **Stage + variant detection** – When stage definitions or variants exist (e.g., "Before your baby arrives", "First child"), the best match is stored in `content_pages.stage` / `stage_variant`.
- **Graph enrichment** – Detected life events are mapped against `lifevents-graph` to infer eligibility statuses, age ranges, and typical durations. Those feed user journeys and SRRS-aware ranking later.
- **Embeddings** – Page docs store a hashed 256-dim bag-of-words embedding to support similarity search inside the helper UIs.

## 5. Typesense storage and lifecycle controls
1. **Schema enforcement** – `scraper.prepareCollection()` ensures `config/typesense-schema.js` for both `content_fragments` and `content_pages` exist and migrates missing fields before uploads.
2. **Batch indexing** – Fragments/page docs import in batches of 100 via Typesense’s `/import` API (with per-doc retries). Each doc includes `crawl_version`, `last_seen_at`, and `popularity_sort` for deterministic ordering.
3. **Pruning** – After indexing a target, `pruneStaleDocs()` deletes any doc where `crawl_version` < current run so removed sections disappear cleanly.

## 6. How the seed taxonomies drive demo stories
- `lifeEvents` *(seed)* – Each event defines keywords, related categories, optional SRRS weight, and stage dictionaries. Example: "Having a baby" contains stages like "Before your baby arrives" and variants such as "First child" or "Surrogacy".
- `categories` *(seed)* – Broad groupings (Health and disability, Work and money, etc.) power cross-domain facets and serve as fallbacks when no single life event dominates.
- `stageVariants` *(seed)* – Capture nuance (first child vs. multiples) so journeys can speak in the user’s context without invoking a model.
- `providers` *(seed)* – Maps governance → agencies and includes domain/keyword hints to keep provider tagging deterministic.
- `lifevents-graph` *(seed)* – Adds structured context: allowed successor events, conflicting states, age bands, typical durations, eligibility evidence. This data flows into the `content_pages` collection and can be surfaced during demos to show we understand prerequisites and risk levels.

## Demo narrative cheat sheet
1. **Crawl story** – “We aim the scraper at a domain (or list). It reads robots.txt, slurps the sitemap, and politely walks only the relevant HTML links while scoring them for service relevance.”
2. **Fragment story** – “Every heading becomes a fragment: we keep its DOM, CSS, breadcrumbs, compute reading level, and attach heuristics so Typesense can answer ‘find forms about bereavement in NSW under Services Australia’ instantly.”
3. **Taxonomy story** – “Fragments are enriched in-flight using the seed taxonomy describing life events, providers, states, and eligibility facets. Missing values are normalised so the UI never gets ‘undefined’ filters.”
4. **Page-level intelligence** – “After fragments upload, we synthesise a page document that declares the primary life event, stage, stage variant, and derived eligibility signals using the life-event graph. This is what fuels journey builders and SRRS-aware ranking.”
5. **Lifecycle hygiene** – “Each crawl is versioned, indexed in batches, and stale docs are deleted automatically, so we can re-run overnight without manual cleanup.”

Use this doc alongside `readme.md` for demo prep—most talking points map to code in `scraper/` and data in `data/` so you can jump into files if stakeholders ask for specifics.
