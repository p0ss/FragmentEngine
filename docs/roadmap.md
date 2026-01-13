# FragmentEngine Roadmap

FragmentEngine is the bootstrap implementation for the GovAI Content Library described in `docs/roadmap-v2.md`. This document focuses on the work required in the early phases (Q1–Q2) to prove out the architecture before the broader GovAI platform replaces individual components. Everything below aligns with the national roadmap while remaining specific to the code in this repository.

## Alignment with GovAI Content Library

- **Strategic Phasing**: FragmentEngine powers the initial Services Australia corpus (Phase 1) and the linked-agency expansion (Phase 2) described in the v2 roadmap. The same technical components (incremental crawl, OpenSearch store, Content Hub exporter, divergence detection) act as reference implementations before govAI teams replace them with production-grade services.
- **Parallel Tracks**: Q1 splits into Track A (Infrastructure/IaC/OpenSearch/Content Hub, led by Finance) and Track B (Enrichment/AEO/UI, led by Services Australia). This repo mostly houses Track B code but must integrate with Track A deliverables.
- **Subscription-driven Versioning**: Deep historical tracking is triggered when fragments/topics have subscribers; this roadmap therefore emphasises provenance metadata and change logs early.

## Timeline Overview

| Quarter | FragmentEngine Focus | Exit Criteria |
|---------|---------------------|---------------|
| Q1 | Parallel tracks (Infra + Enrichment) | Terraform/C DK patterns, OpenSearch + Typesense dual-write, Content Hub schema stub, production scraper with incremental crawl, enrichment pipeline + divergence detection experiments + UI refresh |
| Q2 | Converge to functional alpha | Ownership/topic system online, subscriptions flowing to Content Hub, dashboards available to first agencies |
| Q3 | Alpha iteration | Scale corpus (linked agencies), embed eval/divergence insights in UI, generalise pipeline for govAI handover |
| Q4 | Beta stabilisation / myGov RAG alpha | Harden infra, continuous crawling + syndication, alpha govAI-powered RAG search on myGov |

## 1. Incremental Crawling & Change Tracking

### Goals
- Avoid re-scraping entire domains on every run; treat fragments as a persistent dataset with per-page provenance.
- Capture upstream change data (last modified, hash, ETag) and link it to downstream enrichments.
- Support impact analysis so we know which fragments and enrichments need reprocessing when a source page changes.

### Deliverables
1. **Persistent Crawl Store**
   - Introduce a durable store (SQLite/Postgres or document DB) that tracks each page’s URL, domain, crawl policy (depth, cadence), last status, ETag/Last-Modified, content hash, and owning portfolio.
   - Implement a scheduler that iterates over this store, respecting per-domain throttles and `robots.txt` crawl-delay rules.

2. **Page & Fragment Hashing**
   - Compute stable page-level hashes (HTML canonical form) and fragment hashes (e.g., existing MD5 over heading+content) on every crawl.
   - Skip fragment extraction when hashes match, emitting a “no change” record in the crawl log.

3. **Change Logs & Impact Graph**
   - Record deltas whenever page hashes differ: fragments added/removed/updated, derived `content_pages` adjustments, and enrichment merge outcomes.
   - Surface this metadata via an API endpoint (`/api/crawl/status`?) and dashboards so ops can monitor coverage.

4. **Enrichment Separation & Merge Strategy**
   - Store enrichment payloads (taxonomies, SRRS scores, manual fixes, prompts) separately from raw scraped data, keyed by fragment ID with version metadata.
   - On change, detect whether enrichments diverged from the source and reapply only when needed.

5. **Upstream Health Reporting**
   - Extend `content_pages` schema with fields like `source_hash`, `last_crawled_at`, `last_status_code`, `last_modified_header`, `etag`, `enrichment_version`, `is_up_to_date`.
   - Provide CLI/API tools to list stale sites, error-prone pages, and divergence metrics.
   - Incorporate authenticated crawl support (see “Authentication Barrier” in `docs/PROJECT_PLAN_TAGGING_IMPROVEMENTS.md`) so login-gated government content can be onboarded safely.

## 2. Storage & Search Evolution

### Goals
- Keep Typesense as a fast retrieval layer while preparing for a future OpenSearch-based primary store.
- Abstract indexing so we can plug in multiple backends (Typesense, OpenSearch, Content Hub syndication).

### Deliverables
1. **Repository Abstraction**
   - Wrap fragment/page CRUD in a service layer (e.g., `FragmentRepository`) so the scraper + API don’t talk to Typesense directly.
   - Implement adapters for Typesense (current) and a “raw” store (Postgres/OpenSearch).

2. **Raw Content Archive**
   - Persist raw HTML snapshots to object storage (S3-compatible) with metadata keys referencing page IDs.
   - Link archive objects to change logs for debugging/regression.

3. **OpenSearch Feasibility**
   - Define an OpenSearch mapping mirroring the enriched schema, focusing on incremental updates, vector fields, and per-tenant filters.
   - Prototype dual-write (Typesense + OpenSearch) on a subset of domains to validate performance.

4. **Content Hub Interfaces**
   - Model outbound data contracts needed by Acquia Content Hub: fragment payloads, enrichment metadata, subscription hooks.
   - Add an exporter service that streams changes from the raw/enriched store to Content Hub endpoints, honoring dedupe and retry semantics.

## 3. Topics / Folksonomy Layer

### Goals
- Introduce “topics” as saved searches/tagging rules that map fragments into curator-defined clusters.
- Allow tagging rules to be reusable, versioned, and auditable.

### Deliverables
1. **Topic Definition Schema**
   - Define a `topics` collection (Typesense/OpenSearch + persistent DB) with fields: `id`, `label`, `description`, `rules` (structured query DSL), `owner`, `version`, `created_at`, `updated_at`.
   - Rules can reference any fragment field (life events, providers, SRRS scores, text search terms).

2. **Evaluation Engine**
   - Build a service that executes topic rules across the fragment store, producing membership lists and counts.
   - Support incremental recomputation when fragments change (hook into change log events).

3. **Topic Management UI/API**
   - Add endpoints (& eventual UI) to create/update/delete topics, test rules, and review impacted fragments before publishing.
   - Store topic assignment provenance, so we can explain why a fragment was tagged.

4. **Subscription Hooks**
   - Integrate topics with Content Hub syndication so downstream consumers can subscribe to topic feeds (e.g., “cost of living” topic pushes updates as fragments change).
   - Leverage the tagging roadmap (`docs/PROJECT_PLAN_TAGGING_IMPROVEMENTS.md`) for near-term wins (weighted keyword scoring, life-event graph validation) and plan the semantic/hierarchical tagging phases as dependencies for topic accuracy.

## 4. Analytics & Owner Dashboards

### Goals
- Provide dedicated UIs for website owners, topic owners, and portfolio owners to explore their fragments, monitor content quality, and act on divergence alerts.
- Surface diagnostics (reading level, overlap, eval outcomes) that tie back to the enrichment/change-tracking pipeline.

### Deliverables
1. **Ownership-aware Dashboards**
   - Build views that filter fragments by: (a) website host/agency, (b) topic definitions (saved searches), and (c) portfolio/organisation (via AGOR/directory mappings).
   - Show fragment lists with filters (life event, component type, freshness) and quick actions (open fragment, view source, download CSV).

2. **Quality Analytics Panels**
   - Aggregate metrics per audience: average reading level, percentage of fragments with forms/checklists, enrichment coverage, crawl freshness.
   - Support drill-down to per-fragment stats (reading level, SRRS, component type, last eval status).

3. **Similarity & Overlap Visualisations**
   - Wrap the `/api/overlap` and `/api/pages/similarity` endpoints in UI components so owners can inspect cross-site/topic overlaps.
   - Incorporate embedding-based comparisons (nearest neighbours) to highlight similar guidance across agencies.

4. **Eval & Divergence Feeds**
   - Pull adversarial eval results into dashboards, showing which fragments/topics failed accuracy checks and why.
   - Display “topic divergence” indicators (number of conflicting fragments, unresolved eval failures).

5. **Fact Extraction & Conflict Detection**
   - Extend enrichment to run FEVER-style fact extraction and named-entity recognition per fragment.
   - Compare fact sets within a topic or entity cluster using embeddings + rule-based checks, flagging contradictory statements.
   - Surface these alerts in the UI with evidence and suggested remediation (e.g., contact responsible organisation).
   - Use the AI-powered tagging approach from the tagging plan (few-shot classification, hierarchical confidence) to supply the annotated facts that feed these analytics.

## 5. Ownership & Portfolio Mapping

### Goals
- Determine which government organisation owns each website and, by extension, each fragment.
- Use authoritative datasets (AGOR, directory.gov.au, gov.au registrar) to maintain portfolio mappings.

### Deliverables
1. **Data Ingestion**
   - Pull the AGOR dataset, directory.gov.au, and gov.au registrar data into a normalised store (scheduled ETL jobs).
   - Extract fields: agency name, portfolio, responsibilities, domains, contact channels.

2. **Domain Ownership Resolution**
   - Build a resolver that maps a page’s host to an organisation/portfolio by matching against the ingested datasets (including subdomain handling and redirects).
   - Store the resolved organisation ID on both `content_pages` and `content_fragments` as `owner_org_id`, `portfolio`, `responsible_team`.

3. **Responsibility Tracking**
   - Provide reporting endpoints to list fragments per organisation, identify stale content per owner, and show enrichment divergence per portfolio.
   - Feed ownership metadata into Content Hub exports so syndication flows include provenance.

## 6. Infrastructure & Deployment Automation

### Goals
- Move from local docker-compose to infrastructure-as-code-managed environments (AWS target).
- Support continuous crawling, enrichment, and syndication pipelines with observability.

### Deliverables
1. **IaC Repository (AWS)**
   - Create a dedicated repo (e.g., Terraform or AWS CDK) to provision core resources: VPC, ECS/EKS tasks for scraper/API, Aurora/Postgres for crawl store, OpenSearch domain (optional), S3 for HTML snapshots, SQS/EventBridge for job orchestration, Secrets Manager for credentials.

2. **CI/CD Pipelines**
   - Define build + deploy workflows for scraper, API, MCP server, eval services. Publish docker images to ECR.
   - Automate migrations for crawl/enrichment databases.

3. **Operational Tooling**
   - Add monitoring/alerting (CloudWatch dashboards, metrics for crawl throughput, error rates, backlog).
   - Implement feature flags/environment configs to toggle LiteLLM, SEO capture stack, topic evaluation cadence.

4. **Content Hub Integration Environment**
   - Provision connectivity (VPC endpoints or public APIs) to Acquia Content Hub, including IAM roles and secrets. Support webhook callbacks for subscription events.

## 7. Program Management & Milestones

| Quarter | Focus | Milestones |
| --- | --- | --- |
| Q1 (Tracks A+B) | Incremental crawl foundation + IaC/OpenSearch bootstrap | Terraform/CDK repo, ECS/RDS/OpenSearch/S3 provisioned, persistent crawl DB wired to scraper, change logs + enrichment separation, Content Hub schema stub, divergence experiments integrated in UI |
| Q2 | Ownership + topics + functional alpha | Organisation resolver with AGOR data, topic rule engine, subscription feeds to Content Hub, initial dashboards for website/topic owners |
| Q3 | Analytics & OpenSearch hardening | Repository abstraction + dual-write to OpenSearch, embedding-enabled similarity, eval + divergence dashboards, scale to linked agencies |
| Q4 | Syndication & myGov RAG alpha | IaC-driven production environment, continuous crawling + Content Hub exporter, alpha govAI RAG search on myGov, readiness for govAI teams to replace bootstrap components |

Each phase should include:
- Design doc updates (schemas, APIs).
- Data backfill/migration scripts (e.g., populate ownership fields from AGOR).
- Observability story (dashboards/logging for new components).
- Security review (handling PATs, Content Hub credentials, etc.).

## References & Next Steps
- Align roadmap with existing docs: `docs/scraper-architecture.md`, `docs/evals-and-mcp.md`, `docs/typesense-schema-reference.md`.
- Kick off design spikes for: crawl scheduler service, topic rule DSL, ownership resolver prototype.
- Begin drafting the dedicated IaC repo structure (Terraform modules for crawl store, ECS tasks, S3 buckets).
