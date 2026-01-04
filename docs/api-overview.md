# API Surface Overview

The Express app in `api/server.js` exposes interaction points for the static tools, MCP server, and eval harness. This document summarises each route group and how they interact with Typesense.

## Health
- `GET /health`
  - Verifies the API can reach Typesense (`collections().retrieve()`).
  - Used by `deploy.sh`, helper UIs, and Docker health checks to gate readiness.

## Fragments (`api/routes/fragments.js`)
- `GET /api/fragments/search`
  - Full-text + facet search over `content_fragments` using `query_by=title,content_text,search_keywords`.
  - Filters: `life_event` (via relational lookup into `content_pages`), `category`, `state`, `stage`, `stage_variant`, `provider`, `component_type`.
  - Query params: `q`, `page`, `per_page`, `include_html`, `sort_by` (defaults to `popularity_sort:asc`).
  - Falls back automatically if `srrs_score` sorts cause Typesense errors.
- `GET /api/fragments/search-relational`
  - Delegates to `utils/relational-queries.js` to expand life events via `life_event_graph` relationships.
  - Requires `life_event`. `include_related=true` pulls neighbouring events and returns `relationships` metadata.
- `GET /api/fragments/facets`
  - Builds life event facets from `content_pages` plus fragment facets for categories, providers, stages, SRRS ranges.

## Overlap Explorer (`api/routes/overlap.js`)
- `GET /api/overlap`
  - Fetches up to ~20k fragments from Typesense, partitions them by host, and computes pairwise similarity between two sites (default `servicesaustralia.gov.au` vs `my.gov.au`).
  - Query params: `site_a`, `site_b`, `threshold`, `max_pairs`, `metric` (`combined`, `title`, `content`, `link`), `aggregate=page` (reports coverage at page level), `ignore_generic=true` to skip boilerplate headings.
  - Outputs candidate matches with similarity sub-scores plus optional site-level coverage metrics.

## Pages (`api/routes/pages.js`)
- `GET /api/pages/search`
  - Wrapper over `content_pages` search; supports host/life_event/category filters and caps `per_page` at 250.
- `GET /api/pages/similarity`
  - Generates ranked page pairs across two hosts using tag overlap, keyword embedding cosine similarity, and outbound link tokens. Supports CSV export via `format=csv`.
- `GET /api/pages/graph`
  - Produces link graphs limited by `max_edges`/`max_nodes`, with optional cross-site filtering via `site_a`, `site_b`, `cross_only`.

## Journey + Profile (`api/routes/journey.js`)
- `POST /api/journey/profile/build`
  - Normalises raw user inputs into the structured profile object (`user_profiles` schema) and infers life events (`inferLifeEvents`). Returns a generated `profile_id` (in-memory stub for now).
- `GET /api/journey/:profileId`
  - Mock persistence loads the profile, then `services/ProfileMatcher` queries Typesense to find eligible services, predicts next life events, and assembles a journey graph summary (top 50 services, iteration stats, completeness score).
- `GET /api/journey/:profileId/visualization`
  - Pulls all `life_event_graph` nodes, ensures they have layout coordinates, clusters them, and returns UI-ready data for force-directed or 3D views.

## LLM + Tooling (`api/routes/llm.js` + `api/routes/ollama.js`)
- `GET /api/llm/models`
  - Reports available models from LiteLLM (if `ENABLE_LITELLM=true`) or directly from Ollama (`OLLAMA_URL`). Automatically lists OpenAI models if `OPENAI_API_KEY` is set. Provides per-provider availability diagnostics so the UI can show inline warnings.
- `POST /api/llm/chat`
  - Chat completions endpoint. When LiteLLM is enabled, every request proxies to `${LITELLM_URL}/v1/chat/completions`. Otherwise the route parses `provider:model` strings and talks to Ollama (`/api/generate`) or native HTTP APIs (OpenAI, Anthropic, Groq via LiteLLM).
  - Returns `response: <text>` on success, propagates provider errors verbatim for debugging.
- `POST /api/llm/chat-with-context`
  - (Inside `llm.js`) orchestrates fragment searches + prompt templating to provide retrieval-augmented answers. Used by `multimode-interface.html`.
- `/api/ollama/*`
  - Optional specialised routes (loaded best-effort). If dependencies such as `node-fetch` are missing, the server exposes a 503 stub so the UI can fall back gracefully.

## Miscellaneous
- Every route has access to `app.locals.typesense`, so any new modules should reuse that client for consistency.
- Error handlers centralise stack traces and only leak raw messages when `NODE_ENV=development`.
