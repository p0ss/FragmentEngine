# Agentic Evals & MCP Integration

FragmentEngine ships an adversarial evaluation harness (`evals/`) and an MCP server (`mcp-server/`) so you can benchmark grounded responses that rely on Typesense data.

## Components

| Component | Location | Role |
| --- | --- | --- |
| MCP Server | `mcp-server/index.js` | Exposes Model Context Protocol tools that wrap FragmentEngine searches. Runs over stdio or HTTP. |
| API | `api/` | Provides `/api/fragments`, `/api/pages`, `/api/llm`, etc. The MCP server talks directly to Typesense but shares schemas via `config/typesense-schema.js`. |
| Typesense | Docker service `typesense` | Stores fragments, pages, services, life-event graph. Seeded by the scraper. |
| Eval Runner | `evals/run-eval.js` + `adversarial-orchestrator.js` | Executes baseline/tools/adversarial modes using registry samples. |

## MCP Tooling

`mcp-server/index.js` defines four tools (see `ListToolsRequestSchema` handler):
1. `search_government_services` – full-text search over `content_fragments` with optional filters and sort control (supports SRRS ordering via `sort_by`).
2. `get_service_categories` – fetches available facets to help the model propose filters.
3. `analyze_filter_combinations` – inspects existing filters and suggests new intersections with estimated hit counts.
4. `rank_content_by_relevance` – accepts a small set of fragment titles/metadata and reorders them based on user profile context.

All tools validate input via Zod schemas to keep agent prompts honest, and they reuse the shared Typesense client (`TYPESENSE_HOST/PORT/API_KEY` env vars).

## Eval Modes

From `evals/README.md`:
- **Baseline** (`npm run eval:baseline`) – responder model answers without tool access; reviewer disabled.
- **Tools** (`npm run eval:tools`) – responder can call MCP tools once per prompt.
- **Adversarial** (`npm run eval:adversarial`) – adds a reviewer loop that cross-checks every claim via the same MCP tools, forcing up to 3 correction cycles.
- **All** (`npm run eval:all`) – convenience script that runs the trio sequentially for comparison.

`quick-start.sh` performs smoke tests (Typesense+API health, MCP handshake) before launching small sample runs.

## Data Flow During Adversarial Runs

1. **Sample ingestion** – `registry/data/.../samples.jsonl` supplies the prompt, expected answer, facets, and disallowed claims.
2. **Responder turn** – `adversarial-orchestrator.js` instantiates the responder model (usually Claude/Anthropic via LiteLLM) which can invoke MCP tools mid-response to fetch fragments.
3. **Reviewer turn** – reviewer LLM extracts claims, re-calls MCP tools for verification, and returns `ACCEPT`, `REJECT`, or `NEEDS_REVISION` along with rationale.
4. **Retry loop** – if rejected, responder receives structured feedback (see `prompts/responder-retry.md`) and retries until acceptance or iteration cap.
5. **Logging** – outcomes land under `evals/results/<eval>-<mode>-TIMESTAMP.json` with iteration transcripts and tool logs.

## Running Everything Locally

The pipelines are opt-in:
- `./deploy.sh --with-evals` (or `ENABLE_AI_EVALS_PIPELINE=true`) prepares the adversarial agentic harness (`evals/`).
- `./deploy.sh --with-seo-evals` (or `ENABLE_SEO_EVALS_PIPELINE=true`) installs the Google Search capture tooling under `evals/google-search/` (Puppeteer, Chrome, etc.).

1. Populate Typesense via the scraper (`deploy.sh --crawl` or `docker-compose run --rm scraper`).
2. Start Docker services needed for evals:
   ```bash
   docker-compose up -d typesense mcp-server api
   ```
3. Install eval deps and run smoke tests:
   ```bash
   cd evals
   npm install
   ./quick-start.sh
   ```
4. Launch desired eval mode(s) via `npm run eval:<mode>` (inside `evals/`). For Google Search accuracy checks, `cd evals/google-search` and use the dedicated scripts there.

## Troubleshooting

- **No MCP tools**: ensure `mcp-server` container can resolve the `typesense` host defined in `.env`. Check logs for schema loading errors.
- **Eval timeouts**: models accessed through LiteLLM inherit its timeout (`LITELLM_URL`); adjust there or set `ENABLE_LITELLM=false` to use Ollama directly.
- **Inconsistent schemas**: if you add new fields to `config/typesense-schema.js`, restart both the scraper (to patch collections) and the MCP server (so `createRequire` sees the new definitions).
