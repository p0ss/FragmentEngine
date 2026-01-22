// config/typesense-schema.js
module.exports = {
  // Services are the actual government programs/benefits
  serviceSchema: {
    name: 'services',
    enable_nested_fields: true,
    fields: [
      // Service identification
      { name: 'id', type: 'string' },
      { name: 'service_name', type: 'string' },
      { name: 'service_code', type: 'string', optional: true }, // e.g., 'AGE_PENSION', 'FTB_A'
      { name: 'description', type: 'string' },
      
      // Service provider
      { name: 'provider', type: 'string', facet: true },
      { name: 'governance', type: 'string', facet: true },
      { name: 'department', type: 'string', facet: true },
      
      // Life events this service helps with
      { name: 'life_events', type: 'string[]', facet: true },
      { name: 'categories', type: 'string[]', facet: true },
      
      // Eligibility criteria (structured)
      { name: 'eligibility_statuses', type: 'string[]', facet: true }, // Required statuses
      { name: 'min_age', type: 'int32', optional: true },
      { name: 'max_age', type: 'int32', optional: true },
      { name: 'min_income', type: 'int32', optional: true },
      { name: 'max_income', type: 'int32', optional: true },
      { name: 'assets_test', type: 'object', optional: true },
      { name: 'residency_requirements', type: 'string[]', facet: true },
      { name: 'citizenship_requirements', type: 'string[]', facet: true },
      { name: 'required_documents', type: 'string[]' },
      { name: 'eligibility_rules', type: 'object', optional: true }, // Complex rules/OpenFisca
      
      // Service details
      { name: 'service_type', type: 'string', facet: true }, // payment, concession, support, information
      { name: 'delivery_method', type: 'string[]', facet: true }, // online, phone, in-person
      { name: 'payment_frequency', type: 'string', facet: true, optional: true },
      { name: 'payment_amount', type: 'object', optional: true },
      
      // Relationships
      { name: 'related_services', type: 'string[]' },
      { name: 'incompatible_services', type: 'string[]' }, // Can't receive both
      { name: 'gateway_service', type: 'string', optional: true }, // Must have this first
      
      // Content fragments that describe this service
      { name: 'fragment_ids', type: 'string[]' },
      { name: 'primary_url', type: 'string' },
      { name: 'urls', type: 'string[]' },
      
      // Search optimization
      { name: 'keywords', type: 'string[]' },
      { name: 'common_names', type: 'string[]' }, // Colloquial names
      
      // Metadata
      { name: 'last_updated', type: 'int64' },
      { name: 'review_date', type: 'int64', optional: true },
      { name: 'popularity_score', type: 'int32' },
      { name: 'is_active', type: 'bool' }
    ]
  },
  

  contentFragmentSchema: {
    name: 'content_fragments',
    enable_nested_fields: true,
    default_sorting_field: 'popularity_sort',
    fields: [
      // identity & versioning
      { name: 'crawl_version', type: 'int32' },
      { name: 'last_seen_at', type: 'int64' },

      // core
      { name: 'url', type: 'string', facet: true },
      // Base page URL (no hash/query) for page linkage
      { name: 'page_url', type: 'string', facet: true, optional: true },
      { name: 'anchor', type: 'string', optional: true },
      { name: 'title', type: 'string' },
      { name: 'content_text', type: 'string' },
      { name: 'content_html', type: 'string', index: false, optional: true },

      // hierarchies
      { name: 'site_hierarchy', type: 'string[]', facet: true },
      { name: 'page_hierarchy', type: 'string[]', facet: true },
      { name: 'hierarchy_lvl0', type: 'string', facet: true },
      { name: 'hierarchy_lvl1', type: 'string', facet: true, optional: true },
      { name: 'hierarchy_lvl2', type: 'string', facet: true, optional: true },
      { name: 'hierarchy_lvl3', type: 'string', facet: true, optional: true },

      // Basic taxonomy (non-relational)
      { name: 'categories', type: 'string[]', facet: true },
      { name: 'states', type: 'string[]', facet: true },
      { name: 'provider', type: 'string', facet: true },
      { name: 'governance', type: 'string', facet: true },
      
      // Life events via page relationship (remove direct tagging)
      // Query: fragments[page_url] -> pages[url].life_events[]

      // metadata facets
      { name: 'component_type', type: 'string', facet: true },
      { name: 'has_form', type: 'bool', facet: true },
      { name: 'has_checklist', type: 'bool', facet: true },
      { name: 'reading_level', type: 'int32', optional: true, facet: true },
      // Content hash for duplicate detection (SHA256 of normalized content_text)
      { name: 'content_hash', type: 'string', optional: true, facet: true },

      // presentation (not faceted / not indexed)
      { name: 'classes', type: 'string[]', index: false, optional: true },
      { name: 'styles_raw', type: 'object', index: false, optional: true },

      // relationships
      { name: 'parent_id', type: 'string', optional: true },
      { name: 'child_ids', type: 'string[]', optional: true },
      { name: 'related_ids', type: 'string[]', optional: true },

      // search optimization
      { name: 'search_keywords', type: 'string[]', optional: true },
      { name: 'task_order', type: 'int32', optional: true },

      // vector search placeholder
      { name: 'embedding', type: 'float[]', num_dim: 768, optional: true },

      // sorting helper (pre‑negated so ascending sort → highest first)
      { name: 'popularity_sort', type: 'int32' },
      // Evidence-based life event stress weighting (Holmes & Rahe SRRS)
      { name: 'srrs_score', type: 'int32', optional: true, facet: true },
      
      // Graph relationships via lookup (remove redundant storage)
      // Query: fragments[page_url] -> pages[url].life_events[] -> graph[event_name].prerequisites[]
      
      // Eligibility criteria (structured)
      { name: 'min_age', type: 'int32', optional: true },
      { name: 'max_age', type: 'int32', optional: true },
      { name: 'min_income', type: 'int32', optional: true },
      { name: 'max_income', type: 'int32', optional: true },
      { name: 'required_citizenship', type: 'string[]', facet: true },
      { name: 'required_residency', type: 'string[]', facet: true },
      { name: 'required_disabilities', type: 'string[]', facet: true },
      { name: 'required_employment_status', type: 'string[]', facet: true },
      { name: 'required_housing_status', type: 'string[]', facet: true },
      { name: 'required_caring_status', type: 'bool', optional: true },
      { name: 'required_children', type: 'bool', optional: true },
      { name: 'children_age_ranges', type: 'object[]', optional: true },
      
      // Service linkage
      { name: 'service_id', type: 'string', optional: true },
      { name: 'openfisca_rules', type: 'object', optional: true },
      
      // Journey metadata
      { name: 'typical_duration_days', type: 'int32', optional: true },
      { name: 'urgency_score', type: 'int32', optional: true },
      { name: 'completion_likelihood', type: 'float', optional: true }
    ]
  },

  // Aggregated page documents (one doc per base URL)
  contentPageSchema: {
    name: 'content_pages',
    enable_nested_fields: true,
    fields: [
      // identity & versioning
      { name: 'crawl_version', type: 'int32' },
      { name: 'last_seen_at', type: 'int64' },

      // core
      { name: 'url', type: 'string', facet: true },
      { name: 'host', type: 'string', facet: true },
      { name: 'title', type: 'string', optional: true },
      { name: 'content_text', type: 'string', optional: true },

      // PRIMARY life event tagging (authoritative source)
      { name: 'life_events', type: 'string[]', facet: true },
      { name: 'primary_life_event', type: 'string', facet: true, optional: true }, // Main topic
      { name: 'stage', type: 'string', facet: true, optional: true },
      { name: 'stage_variant', type: 'string', facet: true, optional: true },
      
      // Aggregated taxonomy from fragments  
      { name: 'categories', type: 'string[]', facet: true },
      { name: 'states', type: 'string[]', facet: true },
      { name: 'provider', type: 'string[]', facet: true, optional: true },
      { name: 'governance', type: 'string[]', facet: true, optional: true },
      
      // Page-level eligibility (derived from graph)
      { name: 'eligibility_statuses', type: 'string[]', facet: true, optional: true },
      { name: 'typical_age_range', type: 'int32[]', optional: true }, // [min, max]
      { name: 'typical_duration_days', type: 'int32', optional: true },

      // relationships
      { name: 'fragment_ids', type: 'string[]' },
      { name: 'fragment_count', type: 'int32' },

      // bag-of-words keywords and embedding for similarity
      { name: 'keywords', type: 'string[]', optional: true },
      { name: 'embedding', type: 'float[]', num_dim: 256, optional: true },

      // outbound link graph (content-only links)
      { name: 'out_links', type: 'string[]', optional: true },
      { name: 'out_link_tokens', type: 'string[]', optional: true }
    ]
  },
 // New collection for user profiles
  userProfileSchema: {
    name: 'user_profiles',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'age', type: 'int32' },
      { name: 'income', type: 'int32' },
      { name: 'assets', type: 'int32' },
      { name: 'citizenship', type: 'string[]' },
      { name: 'residency_state', type: 'string' },
      { name: 'disabilities', type: 'string[]' },
      { name: 'employment_status', type: 'string' },
      { name: 'housing_status', type: 'string' },
      { name: 'is_carer', type: 'bool' },
      { name: 'children', type: 'object[]' }, // [{age: 5, has_disability: false}]
      { name: 'current_life_events', type: 'string[]' },
      { name: 'completed_life_events', type: 'string[]' },
      { name: 'disaster_affected', type: 'string[]' },
      { name: 'created_at', type: 'int64' },
      { name: 'updated_at', type: 'int64' }
    ]
  },


  // New collection for life event graph
  lifeEventGraphSchema: {
    name: 'life_event_graph',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'event_name', type: 'string' },
      { name: 'event_type', type: 'string', facet: true }, // state, transition, milestone
      { name: 'prerequisites', type: 'string[]' },
      { name: 'next_states', type: 'string[]' },
      { name: 'concurrent_allowed', type: 'string[]' },
      { name: 'mutually_exclusive', type: 'string[]' },
      { name: 'typical_age_range', type: 'int32[]' },
      { name: 'typical_duration_days', type: 'int32' },
      { name: 'position_x', type: 'float' }, // For visualization
      { name: 'position_y', type: 'float' },
      { name: 'position_z', type: 'float', optional: true },
      { name: 'cluster', type: 'string', facet: true } // Visual grouping
    ]
  }
};
