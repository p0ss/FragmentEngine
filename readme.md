# FragmentEngine Content Extractor

A Typesense-powered content extraction and search system for government websites. This system crawls websites, extracts structured content fragments, enriches them with taxonomies, and provides a powerful search API. It then exposes this backend to produce user profiles, personalised content recommendation, retrieval augemented generation, service checklists and journey map visualisation. 

## Features

- 🕷️ **Smart Web Scraping**: Concurrent crawling with robots.txt compliance
- 📊 **Rich Taxonomies**: Auto-categorization by life events, services, and locations
- 🔍 **Powerful Search**: Faceted search with typo tolerance
- 📦 **HTML Preservation**: Maintains original styling and structure
- 🔄 **Incremental Updates**: Smart versioning prevents duplicates
- 🚀 **Production Ready**: Docker deployment with monitoring

## Quick Start

Follow this track to get from zero install → Typesense full of fragments → multimodal UI → agentic evals.

### 0. Prerequisites

- Docker + Compose plugin (enable Docker and add your user to the `docker` group)
- Node.js 18+ (needed for UI helpers + eval runner)
- `curl` and `jq` for smoke tests

### 1. Clone and configure

```bash
git clone https://github.com/p0ss/FragmentEngine
cd FragmentEngine
cp .env-example .env

# Required secrets
# Edit .env and set TYPESENSE_API_KEY=<your key>

# Optional: enable LiteLLM routing + your preferred model URLs
echo ENABLE_LITELLM=true >> .env
echo OLLAMA_URL=http://172.17.0.1:11434 >> .env  # host.docker.internal on Mac/Win
# Export OPENAI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY if you want remote providers
```

`TYPESENSE_API_KEY` must match between `.env`, UI helpers, and any scripts that talk to Typesense.

### 2. Bring the stack online

```bash
chmod +x deploy.sh
./deploy.sh --crawl   # builds images, boots Typesense + API + MCP, runs the unified scraper once
# Optional: pull in eval tooling (pick what you need)
./deploy.sh --with-evals        # agentic eval harness (API-only, lightweight)
./deploy.sh --with-seo-evals    # Google Search capture/SEO tooling (Puppeteer + Chromium)
```

- Re-run `./deploy.sh` after tweaking `.env`
- Skip `--crawl` if you want to stage data manually
- Health checks:

```bash
curl http://localhost:8108/health               # Typesense ready?
curl http://localhost:3000/health               # API + MCP server ready?
curl http://localhost:3000/api/llm/models       # Models discovered via LiteLLM/Ollama?
```

### 3. Fill Typesense with fragments

```bash
# Default crawl (my.gov.au + servicesaustralia.gov.au)
docker-compose run --rm scraper

# Target your own list
TARGET_URLS="https://www.ato.gov.au,https://www.ndis.gov.au" \
  docker-compose run --rm -e TARGET_URLS="$TARGET_URLS" scraper
```

Confirm ingestion:

```bash
source .env
curl -s -H "X-TYPESENSE-API-KEY: $TYPESENSE_API_KEY" \
  http://localhost:8108/collections/content_fragments | jq '.num_documents'
```

If you want per-page aggregates, open `pages-analyse.html` after the crawl and click **Build content_pages in Typesense** to populate the derived collection used by the overlap visualisations.

### 4. Use the helper UIs to harvest facts & rubric data

Serve the static tools from the repo root so they can reach `http://localhost:3000`:

```bash
python3 -m http.server 4173
# Visit http://localhost:4173/<file>
```

- `fragments-visual.html`: Graph explorer + facet filters for grabbing fragment IDs, context, and example claims. Use this to list the facts you expect (and the hallucinations you want to forbid) before authoring eval prompts.
- `pages-analyse.html`: Builds the `content_pages` collection, compares domains, exports CSV/JSONL, and gives you per-page evidence to cite in rubrics.

Suggested workflow when designing eval samples:
1. Filter fragments by life event/provider and copy authoritative snippets → these become your `ideal` answers.
2. Note fragment IDs + URLs → store them in `fragment_ids` inside the eval sample for traceability.
3. Capture “facts we never want to see” and record them as `disallowed_claims` in the sample.
4. Use the exported CSV/JSONL as a checklist when filling the eval template.

### 5. Launch the multimodal interface

Using the same static server, open `http://localhost:4173/multimode-interface.html`.

What you get:
- Conversational + profile-aware assistant that calls `POST /api/llm/chat-with-context`
- Search + journey builder panes sourced directly from Typesense fragments
- Automatic model dropdown fed by `GET /api/llm/models` (LiteLLM, Ollama, OpenAI, Anthropic, Groq)
- Inline diagnostics if the API or models endpoint is unreachable

If the UI cannot reach the API, check Docker logs for `api`, ensure ports `3000/8108/8081` are open locally, and re-run the health commands from step 2.

### 6. Run the agentic evals

Enable just the tooling you need: `./deploy.sh --with-evals` (or set `ENABLE_AI_EVALS_PIPELINE=true`) prepares the adversarial agentic harness, while `./deploy.sh --with-seo-evals` (or `ENABLE_SEO_EVALS_PIPELINE=true`) installs the Google Search capture/SEO stack.

```bash
cd evals
npm install            # keeps npm scripts happy (no external deps required)
./quick-start.sh      # optional smoke check (verifies services + sample data)

# Full adversarial sweep (baseline + tool-enabled + reviewer loop)
npm run eval:all

# Focus on a single mode if needed
npm run eval:baseline
npm run eval:tools
npm run eval:adversarial
```

Outputs live in `evals/results/<eval>-<mode>-TIMESTAMP.json`. Each result contains:
- `iterations`: responder + reviewer transcripts when running adversarial
- `score`: automatic rubric result (`factual_accuracy`, `completeness`, `entity_verification`)
- Evidence about which claim triggered a rejection

Add or edit cases in `evals/registry/data/government-services-grounding/samples.jsonl`:

```jsonl
{"input":[{"role":"system","content":"You are a helpful assistant with access to the MCP tools."},
           {"role":"user","content":"How long is Paid Parental Leave?"}],
 "ideal":"18 weeks",
 "facets":{"provider":"Services Australia","life_event":"Having a baby"},
 "fragment_ids":["servicesaustralia.gov.au::ppl-overview"],
 "disallowed_claims":["Paid Parental Leave is 26 weeks"],
 "eval_type":"factual_accuracy"}
```

The helper UIs make it easy to grab the fragments, acceptable facts, and forbidden claims that populate `ideal`, `fragment_ids`, and `disallowed_claims`. Run `npm run eval:adversarial` whenever you change a sample to confirm the reviewer can force the responder to stay grounded.

With those steps you now have: (1) Typesense populated with fragments, (2) the multimodal UI pointing at live data, and (3) an adversarial eval harness guarding regressions.


## Usage

### Running a Crawl (Unified Scraper)

```bash
# Run a full crawl of default targets (my.gov.au + servicesaustralia.gov.au)
docker-compose run --rm scraper

# Or specify multiple targets explicitly
TARGET_URLS="https://my.gov.au,https://www.servicesaustralia.gov.au,https://www.ato.gov.au" \
  docker-compose run --rm -e TARGET_URLS="$TARGET_URLS" scraper

# Tuning options
docker-compose run --rm -e MAX_DEPTH=2 -e CONCURRENCY=8 scraper
```

If you prefer targeted runs, the compose file also includes:
- `scraper-mygov`
- `scraper-servicesaustralia`

However, the unified `scraper` service is recommended to keep a single crawl version and simplify pruning/indexing across domains.

### API Examples
# Check if API is running
docker-compose up -d api

# Get collection stats
curl http://localhost:3000/api/fragments/stats/overview

#### Search for content
```bash
curl "http://localhost:3000/api/fragments/search?q=medicare"
```

#### Get available facets
```bash
curl "http://localhost:3000/api/fragments/facets"
```

#### Get specific fragment
```bash
curl "http://localhost:3000/api/fragments/[fragment-id]"
```

#### Get a bulk export
```bash
curl "http://localhost:3000/api/fragments/export"
```

#### List available chat models (via LiteLLM or Ollama)
```bash
curl "http://localhost:3000/api/llm/models"
```

### Integration Example

```javascript
// In your application
async function getChecklistItems(state, stage, stageVariant) {
  const params = new URLSearchParams({
    life_event: 'Having a baby',
    state: state,
    stage: stage,
    stage_variant: stageVariant,
    include_html: true,
    per_page: 100
  });

  const response = await fetch(`http://localhost:3000/api/fragments/search?${params}`);
  const data = await response.json();
  
  return data.results.map(hit => ({
    id: hit.document.id,
    title: hit.document.title,
    description: hit.document.content_text,
    url: hit.document.url,
    html: hit.document.content_html,
    provider: hit.document.provider
  }));
}
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Scraper   │────▶│  Typesense  │◀────│     API     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                         ▲
       │                                         │
       ▼                                         │
┌─────────────┐                           ┌─────────────┐
│  Websites   │                           │  Your App   │
└─────────────┘                           └─────────────┘
```

## Configuration

### Scraper Configuration (`config/scraper-config.js`)
- `maxDepth`: How deep to follow links (default: 3)
- `maxLinksPerPage`: Links to follow per page (default: 10)
- `concurrency`: Parallel crawling threads (default: 5)

### Taxonomy Configuration (`data/seed-taxonomies.json`)
- Life events and their keywords
- Service categories
- Government providers
- State mappings

## Development

### Local Development Setup

```bash
# Install dependencies
cd scraper && npm install
cd ../api && npm install

# Run Typesense
docker run -p 8108:8108 -v/tmp/typesense-data:/data \
  typesense/typesense:0.25.1 \
  --data-dir /data --api-key=xyz123

# Run scraper
cd scraper && npm start

# Run API
cd api && npm start
```

### Chat/LLM Integration

This stack runs LiteLLM by default (via Docker Compose) to proxy requests to local Ollama and/or remote APIs. The UI auto-discovers models from LiteLLM and provides a dropdown to switch.

- Configure in `.env`:
  - `OLLAMA_URL` → where your local Ollama is reachable from within Docker.
    - Linux: `http://172.17.0.1:11434`
    - Mac/Windows: `http://host.docker.internal:11434`
  - `OPENAI_API_KEY` → optional, enables OpenAI models in LiteLLM.
- The API uses `LITELLM_URL=http://litellm:4000` by default (in-compose DNS).

You can verify models available via:
```bash
curl http://localhost:3000/api/llm/models
```

### Adding New Taxonomies

Edit `data/seed-taxonomies.json` to add new:
- Life events
- Categories
- Providers
- Stage variants

## Monitoring

Check crawl status:
```bash
docker-compose logs -f scraper
```

Check API health:
```bash
curl http://localhost:3000/health
```

View Typesense metrics:
```bash
curl http://localhost:8108/metrics.json
```

## Troubleshooting

### Crawl is too slow
- Increase `CONCURRENCY` in `.env`
- Reduce `maxDepth` for faster initial crawls

### Out of memory
- Adjust Docker memory limits in `docker-compose.yml`
- Reduce `CONCURRENCY`

### Missing content
- Check robots.txt compliance
- Verify selectors in `config/scraper-config.js`
- Check crawl depth settings

## Documentation Map

- [Scraper Architecture & Operations](docs/scraper-architecture.md)
- [Typesense Schema Reference](docs/typesense-schema-reference.md)
- [API Surface Overview](docs/api-overview.md)
- [Agentic Evals & MCP Integration](docs/evals-and-mcp.md)
- [Fragment Lifecycle](docs/fragment-lifecycle.md)
- [Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md)
- [Adversarial Eval Summary](docs/ADVERSARIAL_EVALS_SUMMARY.md)
- [Project Plan: Tagging Improvements](docs/PROJECT_PLAN_TAGGING_IMPROVEMENTS.md)

## License

MIT
