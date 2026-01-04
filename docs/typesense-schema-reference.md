# Typesense Schema Reference

The repo ships a single source of truth for all Typesense collections in `config/typesense-schema.js`. This guide summarises each schema, its key fields, and the features that depend on them.

## Services (`services`)
Purpose: describe government programs/benefits and link them back to authoritative fragments.

Field clusters:
- **Identity**: `id`, `service_name`, optional `service_code`.
- **Provider metadata**: `provider`, `governance`, `department` (all facet-enabled).
- **Taxonomy**: `life_events`, `categories` for surfacing in UI filters and MCP tools.
- **Eligibility**: numeric bounds (`min_age`, `max_income`, etc.), `eligibility_statuses`, `residency_requirements`, `citizenship_requirements`, document lists, and `eligibility_rules` blobs for OpenFisca alignment.
- **Service logistics**: `service_type`, `delivery_method`, optional payment frequency/amount, incompatible/related services, and `gateway_service` pointers.
- **Content linkage**: `fragment_ids`, `primary_url`, `urls`, plus `keywords`/`common_names` for search synonyms.
- **Operations**: timestamps (`last_updated`, `review_date`), `popularity_score`, boolean `is_active`.

Used by: `ProfileMatcher`, journey builder, future service-centric APIs.

## Content Fragments (`content_fragments`)
Purpose: atomic pieces of content tied to specific headings/anchors and enriched for retrieval.

Field clusters:
- **Versioning**: `crawl_version`, `last_seen_at` ensure dedupe + stale pruning.
- **Core content**: `url`, `page_url`, `anchor`, `title`, `content_text`, optional `content_html`.
- **Hierarchy**: `site_hierarchy`, `page_hierarchy`, `hierarchy_lvl0-3` used by graph explorer and Typesense facets.
- **Taxonomy + provenance**: `categories`, `states`, `provider`, `governance`, `component_type`, `has_form`, `has_checklist`, `reading_level`.
- **Presentation**: non-indexed `classes` and `styles_raw` (inline + computed) so the UI can recreate styling when embedding snippets.
- **Relationships**: `parent_id`, `child_ids`, `related_ids` for nestable tasks, plus `service_id` bridging to `services`.
- **Eligibility**: numerical thresholds, `required_*` arrays, `children_age_ranges`, `typical_duration_days`, `urgency_score`, `completion_likelihood`.
- **Search helpers**: `search_keywords`, `task_order`, `embedding` (768-dim), `popularity_sort`, `srrs_score`.

Used by: `/api/fragments/*`, MCP search tools, journey builder (eligibility filters), fragment visualiser, overlap comparisons.

## Content Pages (`content_pages`)
Purpose: aggregated per-URL documents derived from fragments for overlap analysis, CSV exports, and similarity calculations.

Field clusters:
- **Identity**: `crawl_version`, `last_seen_at`, `url`, `host`, optional `title`/`content_text`.
- **Primary tagging**: authoritative `life_events`, `primary_life_event`, `stage`, `stage_variant` (UI lifecycles depend on these facets).
- **Aggregated taxonomy**: union of fragment `categories`, `states`, `provider`, `governance`.
- **Eligibility roll-ups**: `eligibility_statuses`, `typical_age_range`, `typical_duration_days`.
- **Relationships**: `fragment_ids`, `fragment_count` used for coverage metrics.
- **Similarity signals**: `keywords`, 256-dim `embedding`, `out_links`, `out_link_tokens` powering `/api/pages/similarity` and graph views.

## User Profiles (`user_profiles`)
Purpose: persist structured user inputs for journey generation and service matching.

Fields capture demographics, finances, status, caring responsibilities, children metadata, life events, disasters, and timestamps.

## Life Event Graph (`life_event_graph`)
Purpose: express transitions between life events and supply 2D/3D co-ordinates for the journey visualiser.

Key fields: `event_name`, `event_type`, adjacency lists (`prerequisites`, `next_states`, `concurrent_allowed`, `mutually_exclusive`), demographics, `typical_duration_days`, `cluster`, optional `position_z`.

## Schema Maintenance Tips

- `scraper/scraper.js` calls `collections().update({ fields })` to backfill any missing definition so you can add new fields directly to `config/typesense-schema.js` and rerun the scraper.
- Keep field additions backward-compatible (mark optional where possible) to avoid breaking existing docs.
- Collections referenced by the API (`content_fragments`, `content_pages`, `life_event_graph`, `services`) must retain the exact names defined here; update both the schema file and the consuming routes if you rename them.
