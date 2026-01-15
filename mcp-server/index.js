#!/usr/bin/env node

/**
 * MyGov MCP Server
 * Provides Model Context Protocol tools for searching government services via Typesense
 * Supports both MCP stdio (for external models) and HTTP bridge (for internal API)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import Typesense from "typesense";
import { z } from "zod";
import express from 'express';
import { createRequire } from 'module';

// Load central Typesense schemas (CommonJS) from repo config
const require = createRequire(import.meta.url);
let typesenseSchemas;
try {
  typesenseSchemas = require('../config/typesense-schema.js');
} catch (e) {
  console.warn('⚠️ Could not load central Typesense schemas from ../config/typesense-schema.js:', e.message);
  typesenseSchemas = null;
}

// Initialize Typesense client
const typesenseClient = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST || "typesense",
      port: parseInt(process.env.TYPESENSE_PORT || "8108", 10),
      protocol: "http",
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY || "xyz123abc",
  connectionTimeoutSeconds: 10,
});

// Validation schemas
const SearchFragmentsSchema = z.object({
  query: z.string().describe("Search query for government services"),
  category: z.string().optional().describe("Filter by category (e.g., 'Health and caring')"),
  life_event: z.string().optional().describe("Filter by life event (e.g., 'Having a baby')"),
  provider: z.string().optional().describe("Filter by provider (e.g., 'Services Australia')"),
  state: z.string().optional().describe("Filter by state (e.g., 'NSW')"),
  per_page: z.number().min(1).max(50).default(5).describe("Number of results to return"),
  sort_by: z.string().optional().describe("Typesense sort_by, e.g., 'srrs_score:desc,popularity_sort:asc'"),
});

const GetFacetsSchema = z.object({
  query: z.string().optional().describe("Optional search query to get facets for"),
});

const AnalyzeFilterCombinationsSchema = z.object({
  existing_filters: z.object({
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
    state: z.string().optional(),
  }).optional().describe("Currently applied filters"),
  max_options: z.number().min(3).max(10).default(6).describe("Maximum number of options to suggest"),
});

const RankContentByRelevanceSchema = z.object({
  content_titles: z.array(z.object({
    id: z.string(),
    title: z.string(),
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
  })).describe("Array of content items with titles and metadata to rank"),
  user_profile: z.object({
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
    state: z.string().optional(),
  }).describe("User's filter selections representing their life circumstances"),
});

// Create MCP server
const server = new Server(
  {
    name: "mygov-search-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_government_services",
        description: "Search for Australian government services and information using natural language queries. Returns relevant documents with content, provider details, and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for government services (e.g., 'maternity leave', 'tax returns', 'visa applications')"
            },
            category: {
              type: "string",
              description: "Optional category filter",
              enum: ["Health and caring", "Family and relationships", "Work and Money", "Housing and Travel", "Disasters and Crime", "Education and Identity"]
            },
            life_event: {
              type: "string", 
              description: "Optional life event filter (e.g., 'Having a baby', 'Getting married')"
            },
            provider: {
              type: "string",
              description: "Optional provider filter (e.g., 'Services Australia', 'Australian Taxation Office')"
            },
            state: {
              type: "string",
              description: "Optional state filter (e.g., 'NSW', 'VIC', 'QLD')"
            },
            per_page: {
              type: "number",
              description: "Number of results to return (1-50, default: 5)",
              minimum: 1,
              maximum: 50,
              default: 5
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_service_categories",
        description: "Get available categories, life events, providers, and states for filtering government services. Useful for understanding what filters are available.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Optional search query to get facets for specific results"
            }
          }
        }
      },
      {
        name: "analyze_filter_combinations",
        description: "Analyze filter combinations to suggest optimal next filtering options with result counts. Helps build user's intersectional life experience profile by suggesting the most relevant filter choices.",
        inputSchema: {
          type: "object",
          properties: {
            existing_filters: {
              type: "object",
              description: "Currently applied filters",
              properties: {
                category: { type: "string", description: "Current category filter" },
                life_event: { type: "string", description: "Current life event filter" },
                provider: { type: "string", description: "Current provider filter" },
                state: { type: "string", description: "Current state filter" }
              }
            },
            max_options: {
              type: "number",
              description: "Maximum number of options to suggest (3-10, default: 6)",
              minimum: 3,
              maximum: 10,
              default: 6
            }
          }
        }
      },
      {
        name: "rank_content_by_relevance", 
        description: "Rank content titles by individual specificity and life impact priority for personalized content ordering. Only uses titles and metadata, not full content.",
        inputSchema: {
          type: "object",
          properties: {
            content_titles: {
              type: "array",
              description: "Array of content items with titles and metadata to rank",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Content item ID" },
                  title: { type: "string", description: "Content title/heading" },
                  category: { type: "string", description: "Content category" },
                  life_event: { type: "string", description: "Associated life event" },
                  provider: { type: "string", description: "Service provider" }
                },
                required: ["id", "title"]
              }
            },
            user_profile: {
              type: "object", 
              description: "User's filter selections representing their life circumstances",
              properties: {
                category: { type: "string", description: "User's selected category" },
                life_event: { type: "string", description: "User's selected life event" },
                provider: { type: "string", description: "User's selected provider" },
                state: { type: "string", description: "User's selected state" }
              }
            }
          },
          required: ["content_titles", "user_profile"]
        }
      }
    ]
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_government_services": {
        const result = await performSearch(args.query, args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_service_categories": {
        const params = GetFacetsSchema.parse(args);
        
        // Get facets from Typesense
        const searchParams = {
          q: params.query || "*",
          query_by: "title,content_text", 
          facet_by: "categories,life_events,provider,states",
          per_page: 0, // We only want facets, not results
        };

        const response = await typesenseClient
          .collections("content_fragments")
          .documents()
          .search(searchParams);

        return {
          content: [
            {
              type: "text", 
              text: JSON.stringify({
                categories: response.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
                life_events: response.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
                providers: response.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
                states: response.facet_counts?.find(f => f.field_name === "states")?.counts || [],
              }, null, 2)
            }
          ]
        };
      }

      case "analyze_filter_combinations": {
        const params = AnalyzeFilterCombinationsSchema.parse(args);
        const existingFilters = params.existing_filters || {};
        const maxOptions = params.max_options;

        // Get all available facets first
        const facetsResponse = await typesenseClient
          .collections("content_fragments")
          .documents()
          .search({
            q: "*",
            query_by: "title,content_text",
            facet_by: "categories,life_events,provider,states",
            per_page: 0,
          });

        const facets = {
          categories: facetsResponse.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
          life_events: facetsResponse.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
          providers: facetsResponse.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
          states: facetsResponse.facet_counts?.find(f => f.field_name === "states")?.counts || [],
        };

        // Analyze combinations based on existing filters
        const suggestions = [];
        
        // If no filters applied, suggest top categories
        if (!existingFilters.category && !existingFilters.life_event && !existingFilters.provider && !existingFilters.state) {
          const topCategories = facets.categories
            .sort((a, b) => b.count - a.count)
            .slice(0, maxOptions)
            .map(cat => ({
              type: 'category',
              value: cat.value,
              label: cat.value,
              count: cat.count,
              description: `${cat.count} results in ${cat.value}`
            }));
          suggestions.push(...topCategories);
        } else {
          // Build current filter conditions for testing combinations
          const testCombinations = async (filterType, filterValues) => {
            const results = [];
            for (const filterValue of filterValues) {
              // Test this filter combination
              const testFilters = { ...existingFilters };
              testFilters[filterType] = filterValue.value;

              const filterConditions = [];
              if (testFilters.category) filterConditions.push(`categories:=[${testFilters.category}]`);
              if (testFilters.life_event) filterConditions.push(`life_events:=[${testFilters.life_event}]`);
              if (testFilters.provider) filterConditions.push(`provider:=${testFilters.provider}`);
              if (testFilters.state && testFilters.state !== "National") filterConditions.push(`states:=[${testFilters.state}]`);

              try {
                const testResponse = await typesenseClient
                  .collections("content_fragments")
                  .documents()
                  .search({
                    q: "*",
                    query_by: "title,content_text",
                    filter_by: filterConditions.length > 0 ? filterConditions.join(" && ") : undefined,
                    per_page: 0,
                  });

                if (testResponse.found > 0) {
                  results.push({
                    type: filterType,
                    value: filterValue.value,
                    label: filterValue.value,
                    count: testResponse.found,
                    description: `${testResponse.found} results for ${filterValue.value}`,
                    priority: testResponse.found // Higher count = higher priority for now
                  });
                }
              } catch (error) {
                console.error(`Error testing ${filterType}=${filterValue.value}:`, error);
              }
            }
            return results;
          };

          // Test next logical filter progression
          if (!existingFilters.category) {
            const categoryOptions = await testCombinations('category', facets.categories.slice(0, 8));
            suggestions.push(...categoryOptions);
          } else if (!existingFilters.life_event) {
            const lifeEventOptions = await testCombinations('life_event', facets.life_events.slice(0, 8));
            suggestions.push(...lifeEventOptions);
          } else if (!existingFilters.provider) {
            const providerOptions = await testCombinations('provider', facets.providers.slice(0, 8));
            suggestions.push(...providerOptions);
          } else if (!existingFilters.state) {
            const stateOptions = await testCombinations('state', facets.states.slice(0, 8));
            suggestions.push(...stateOptions);
          }
        }

        // Sort by priority (count) and limit to max_options
        const finalSuggestions = suggestions
          .sort((a, b) => b.priority - a.priority)
          .slice(0, maxOptions);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                current_filters: existingFilters,
                suggestions: finalSuggestions,
                total_available_facets: {
                  categories: facets.categories.length,
                  life_events: facets.life_events.length,
                  providers: facets.providers.length,
                  states: facets.states.length,
                }
              }, null, 2)
            }
          ]
        };
      }

      case "rank_content_by_relevance": {
        const params = RankContentByRelevanceSchema.parse(args);
        const { content_titles, user_profile } = params;

        // Scoring algorithm: Individual specificity first, then life impact
        const rankedContent = content_titles.map(content => {
          let score = 0;
          let specificity = 0;
          let lifeImpact = 0;

          // Specificity scoring (higher = more specific to user)
          if (content.category === user_profile.category) specificity += 30;
          if (content.life_event === user_profile.life_event) specificity += 25;
          if (content.provider === user_profile.provider) specificity += 20;

          // Life impact scoring based on title keywords (higher = more immediate impact)
          const title = content.title.toLowerCase();
          
          // High impact keywords (immediate action needed)
          if (title.includes('apply') || title.includes('application')) lifeImpact += 15;
          if (title.includes('payment') || title.includes('benefit')) lifeImpact += 15;
          if (title.includes('deadline') || title.includes('due') || title.includes('expires')) lifeImpact += 20;
          if (title.includes('emergency') || title.includes('urgent')) lifeImpact += 25;
          
          // Medium impact keywords (important but less immediate)
          if (title.includes('eligibility') || title.includes('qualify')) lifeImpact += 10;
          if (title.includes('how to') || title.includes('guide')) lifeImpact += 8;
          if (title.includes('support') || title.includes('help')) lifeImpact += 10;
          
          // Lower impact (informational)
          if (title.includes('about') || title.includes('information') || title.includes('overview')) lifeImpact += 5;

          // Combine scores: Specificity is weighted more heavily
          score = (specificity * 2) + lifeImpact;

          return {
            ...content,
            score,
            specificity_score: specificity,
            life_impact_score: lifeImpact,
          };
        });

        // Sort by score (highest first)
        rankedContent.sort((a, b) => b.score - a.score);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                user_profile,
                ranked_content: rankedContent,
                ranking_explanation: "Content ranked by individual specificity (category, life event, provider matches) weighted 2x, plus life impact priority (action urgency, benefit availability, etc.)"
              }, null, 2)
            }
          ]
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }

    console.error(`Error in ${name}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      `Search error: ${error.message}`
    );
  }
});

// HTTP bridge for internal API communication
const app = express();
app.use(express.json());

// Reusable search function
async function performSearch(query, options = {}) {
  const params = SearchFragmentsSchema.parse({ query, ...options });
  
  // Build Typesense search parameters
  // Note: content_fragments collection does NOT have life_events field
  const searchParams = {
    q: params.query || "*",
    query_by: "title,content_text",
    include_fields: "id,title,url,content_text,content_html,categories,provider,states,hierarchy_lvl0,srrs_score",
    per_page: params.per_page,
    page: 1,
  };

  // Add filters (life_events not available in content_fragments)
  const filterConditions = [];
  if (params.category) {
    filterConditions.push(`categories:=[${params.category}]`);
  }
  // Note: life_event filter skipped - field not in content_fragments schema
  if (params.provider) {
    filterConditions.push(`provider:=${params.provider}`);
  }
  if (params.state && params.state !== "National") {
    filterConditions.push(`states:=[${params.state}]`);
  }

  if (filterConditions.length > 0) {
    searchParams.filter_by = filterConditions.join(" && ");
  }
  if (params.sort_by) {
    searchParams.sort_by = params.sort_by;
  } else {
    searchParams.sort_by = 'srrs_score:desc,popularity_sort:asc';
  }

  // Execute search with fallback if SRRS sort unsupported
  let response;
  try {
    response = await typesenseClient
      .collections("content_fragments")
      .documents()
      .search(searchParams);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if ((searchParams.sort_by || '').includes('srrs_score')) {
      console.warn('Typesense search failed with SRRS sort, retrying without SRRS:', msg);
      const fallback = { ...searchParams };
      delete fallback.sort_by;
      response = await typesenseClient
        .collections("content_fragments")
        .documents()
        .search(fallback);
    } else {
      throw e;
    }
  }

  // Format results
  // Note: content_fragments doesn't have life_events field
  const results = response.hits.map((hit) => ({
    id: hit.document.id,
    title: hit.document.title,
    url: hit.document.url,
    content: hit.document.content_text,
    content_html: hit.document.content_html,
    category: hit.document.categories?.[0] || "General",
    life_event: "General", // life_events not in content_fragments schema
    provider: hit.document.provider || "Services Australia",
    state: hit.document.states?.[0] || "National",
    hierarchy: hit.document.hierarchy_lvl0 || hit.document.title,
  }));

  return {
    query: params.query,
    total_results: response.found,
    results: results,
    search_metadata: {
      filters_applied: filterConditions,
      search_time_ms: response.search_time_ms,
    }
  };
}

// HTTP endpoint for internal API communication
app.post('/search', async (req, res) => {
  try {
    const result = await performSearch(req.body.query, req.body);
    res.json(result);
  } catch (error) {
    console.error('HTTP Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Dedicated facets endpoint (self-describing filters)
// GET /facets?query=...  or POST /facets { query }
app.all('/facets', async (req, res) => {
  try {
    const query = (req.method === 'GET' ? (req.query.query || req.query.q) : req.body?.query) || '*';
    const response = await typesenseClient
      .collections("content_fragments")
      .documents()
      .search({
        q: query,
        query_by: "title,content_text",
        facet_by: "categories,life_events,provider,states",
        per_page: 0,
      });

    const out = {
      query,
      facets: {
        categories: response.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
        life_events: response.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
        providers: response.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
        states: response.facet_counts?.find(f => f.field_name === "states")?.counts || [],
      },
      found: response.found,
    };
    res.json(out);
  } catch (error) {
    console.error('HTTP Facets error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Schema endpoints (self-describing API)
app.get('/schema', async (req, res) => {
  try {
    if (!typesenseSchemas) {
      return res.status(500).json({ error: 'Typesense schemas not available in server context' });
    }
    res.json({
      schemas: typesenseSchemas,
    });
  } catch (error) {
    console.error('HTTP Schema error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate current Typesense collections against expected schema
app.get('/schema/validate', async (req, res) => {
  try {
    if (!typesenseSchemas) {
      return res.status(500).json({ error: 'Typesense schemas not available in server context' });
    }

    const expected = typesenseSchemas.contentFragmentSchema;
    const collectionName = expected?.name || 'content_fragments';
    let actual;
    try {
      actual = await typesenseClient.collections(collectionName).retrieve();
    } catch (e) {
      return res.json({
        ok: false,
        collection: collectionName,
        error: `Collection not found: ${collectionName}`,
      });
    }

    const expectedFields = new Map((expected.fields || []).map(f => [f.name, f]));
    const actualFields = new Map((actual.fields || []).map(f => [f.name, f]));

    const missing = [];
    const mismatched = [];
    for (const [name, exp] of expectedFields.entries()) {
      const act = actualFields.get(name);
      if (!act) {
        missing.push(name);
        continue;
      }
      // Shallow compare important props
      const propsToCheck = ['type', 'facet', 'index', 'optional', 'num_dim'];
      const diffs = {};
      for (const p of propsToCheck) {
        if ((exp[p] ?? undefined) !== (act[p] ?? undefined)) {
          diffs[p] = { expected: exp[p], actual: act[p] };
        }
      }
      if (Object.keys(diffs).length > 0) {
        mismatched.push({ name, diffs });
      }
    }

    const extra = [];
    for (const name of actualFields.keys()) {
      if (!expectedFields.has(name)) extra.push(name);
    }

    const ok = missing.length === 0 && mismatched.length === 0;
    res.json({
      collection: collectionName,
      ok,
      missing_fields: missing,
      mismatched_fields: mismatched,
      extra_fields: extra,
      expected_default_sorting_field: expected.default_sorting_field,
      actual_default_sorting_field: actual.default_sorting_field,
    });
  } catch (error) {
    console.error('HTTP Schema Validate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for analyzing filter combinations
app.post('/analyze-combinations', async (req, res) => {
  try {
    // Call the handler directly instead of using server.request
    const params = AnalyzeFilterCombinationsSchema.parse(req.body);
    const existingFilters = params.existing_filters || {};
    const maxOptions = params.max_options;

    // Get all available facets first
    const facetsResponse = await typesenseClient
      .collections("content_fragments")
      .documents()
      .search({
        q: "*",
        query_by: "title,content_text",
        facet_by: "categories,life_events,provider,states",
        per_page: 0,
      });

    const facets = {
      categories: facetsResponse.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
      life_events: facetsResponse.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
      providers: facetsResponse.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
      states: facetsResponse.facet_counts?.find(f => f.field_name === "states")?.counts || [],
    };

    // Analyze combinations based on existing filters
    const suggestions = [];
    
    // If no filters applied, suggest top categories
    if (!existingFilters.category && !existingFilters.life_event && !existingFilters.provider && !existingFilters.state) {
      const topCategories = facets.categories
        .sort((a, b) => b.count - a.count)
        .slice(0, maxOptions)
        .map(cat => ({
          type: 'category',
          value: cat.value,
          label: cat.value,
          count: cat.count,
          description: `${cat.count} results in ${cat.value}`,
          priority: cat.count // Add priority for consistency
        }));
      suggestions.push(...topCategories);
    } else {
      // Build current filter conditions for testing combinations
      const testCombinations = async (filterType, filterValues) => {
        const results = [];
        for (const filterValue of filterValues) {
          // Test this filter combination
          const testFilters = { ...existingFilters };
          testFilters[filterType] = filterValue.value;

          const filterConditions = [];
          if (testFilters.category) filterConditions.push(`categories:=[${testFilters.category}]`);
          if (testFilters.life_event) filterConditions.push(`life_events:=[${testFilters.life_event}]`);
          if (testFilters.provider) filterConditions.push(`provider:=${testFilters.provider}`);
          if (testFilters.state && testFilters.state !== "National") filterConditions.push(`states:=[${testFilters.state}]`);
          
          console.log(`Testing combination for ${filterType}=${filterValue.value}:`, filterConditions);

          try {
            const testResponse = await typesenseClient
              .collections("content_fragments")
              .documents()
              .search({
                q: "*",
                query_by: "title,content_text",
                filter_by: filterConditions.length > 0 ? filterConditions.join(" && ") : undefined,
                per_page: 0,
              });

            console.log(`Results for ${filterType}=${filterValue.value}: ${testResponse.found} found`);
            
            if (testResponse.found > 0) {
              results.push({
                type: filterType,
                value: filterValue.value,
                label: filterValue.value,
                count: testResponse.found,
                description: `${testResponse.found} results for ${filterValue.value}`,
                priority: testResponse.found
              });
            }
          } catch (error) {
            console.error(`Error testing ${filterType}=${filterValue.value}:`, error);
          }
        }
        return results;
      };

      // Test next logical filter progression with category-specific filtering
      if (!existingFilters.category) {
        const categoryOptions = await testCombinations('category', facets.categories.slice(0, 8));
        suggestions.push(...categoryOptions);
      } else if (!existingFilters.life_event) {
        // Filter life events to be more relevant to the selected category
        let relevantLifeEvents = facets.life_events;
        
        // Category-specific life event filtering
        if (existingFilters.category === 'Family and relationships') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('baby') ||
            le.value.toLowerCase().includes('marriage') ||
            le.value.toLowerCase().includes('divorce') ||
            le.value.toLowerCase().includes('family') ||
            le.value.toLowerCase().includes('child') ||
            le.value.toLowerCase().includes('relationship') ||
            le.value.toLowerCase().includes('caring') ||
            le.value.toLowerCase().includes('domestic')
          );
        } else if (existingFilters.category === 'Health and caring') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('illness') ||
            le.value.toLowerCase().includes('health') ||
            le.value.toLowerCase().includes('disability') ||
            le.value.toLowerCase().includes('mental') ||
            le.value.toLowerCase().includes('caring') ||
            le.value.toLowerCase().includes('medical')
          );
        } else if (existingFilters.category === 'Work and Money') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('job') ||
            le.value.toLowerCase().includes('work') ||
            le.value.toLowerCase().includes('unemploy') ||
            le.value.toLowerCase().includes('retire') ||
            le.value.toLowerCase().includes('study') ||
            le.value.toLowerCase().includes('financial')
          );
        } else if (existingFilters.category === 'Housing and Travel') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('moving') ||
            le.value.toLowerCase().includes('travel') ||
            le.value.toLowerCase().includes('home') ||
            le.value.toLowerCase().includes('house') ||
            le.value.toLowerCase().includes('rental')
          );
        }
        
        // If no category-specific matches found, use top life events
        if (relevantLifeEvents.length === 0) {
          relevantLifeEvents = facets.life_events.slice(0, 8);
        }
        
        const lifeEventOptions = await testCombinations('life_event', relevantLifeEvents.slice(0, 8));
        suggestions.push(...lifeEventOptions);
      } else if (!existingFilters.provider) {
        // Only suggest providers that actually have content for this category + life event combination
        const providerOptions = await testCombinations('provider', facets.providers.slice(0, 6));
        suggestions.push(...providerOptions);
      } else if (!existingFilters.state) {
        const stateOptions = await testCombinations('state', facets.states.slice(0, 6));
        suggestions.push(...stateOptions);
      }
    }

    // Sort by priority (count) and limit to max_options
    const finalSuggestions = suggestions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxOptions);

    const result = {
      current_filters: existingFilters,
      suggestions: finalSuggestions,
      total_available_facets: {
        categories: facets.categories.length,
        life_events: facets.life_events.length,
        providers: facets.providers.length,
        states: facets.states.length,
      }
    };
    
    console.log('MCP Analysis result:', JSON.stringify(result, null, 2));
    
    res.json(result);
  } catch (error) {
    console.error('HTTP Analyze Combinations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for ranking content by relevance
app.post('/rank-content', async (req, res) => {
  try {
    const result = await server.request({
      method: 'tools/call',
      params: {
        name: 'rank_content_by_relevance',
        arguments: req.body
      }
    });
    
    // Parse the JSON content from the MCP response
    const jsonContent = JSON.parse(result.content[0].text);
    res.json(jsonContent);
  } catch (error) {
    console.error('HTTP Rank Content error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ============================================================================
// V2 API Endpoints - New focused tools for agent-based grounding
// ============================================================================

// V2.1: search_fragments - Semantic search + facet filtering
app.post('/v2/search', async (req, res) => {
  try {
    const { query = '*', facets = {}, per_page = 10, page = 1, include_html = false } = req.body;

    // Build filter conditions from facets
    const filterConditions = [];
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

    if (facets.life_event) filterConditions.push(`life_events:=[${quote(facets.life_event)}]`);
    if (facets.category) filterConditions.push(`categories:=[${quote(facets.category)}]`);
    if (facets.provider) filterConditions.push(`provider:=${quote(facets.provider)}`);
    if (facets.state && facets.state !== 'National') filterConditions.push(`states:=[${quote(facets.state)}]`);

    // Fields to include
    const includeFields = [
      'id', 'url', 'title', 'content_text',
      'hierarchy_lvl0', 'hierarchy_lvl1', 'hierarchy_lvl2',
      'life_events', 'categories', 'states', 'provider',
      'component_type', 'last_modified'
    ];

    if (include_html) {
      includeFields.push('content_html', 'styles_raw', 'classes');
    }

    const searchParams = {
      q: query,
      query_by: 'title,content_text,search_keywords',
      filter_by: filterConditions.length > 0 ? filterConditions.join(' && ') : undefined,
      per_page: parseInt(per_page, 10),
      page: parseInt(page, 10),
      include_fields: includeFields.join(','),
      facet_by: 'life_events,categories,provider,states',
      num_typos: 2
    };

    const response = await typesenseClient
      .collections('content_fragments')
      .documents()
      .search(searchParams);

    res.json({
      results: response.hits?.map(h => h.document) || [],
      found: response.found || 0,
      page: response.page || 1,
      facet_counts: response.facet_counts || []
    });

  } catch (error) {
    console.error('V2 Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// V2.2: get_facets - Discover available filter values
app.post('/v2/facets', async (req, res) => {
  try {
    const { query = '*', for_facets = {} } = req.body;

    // Build filter conditions for scoped facets
    const filterConditions = [];
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

    if (for_facets.life_event) filterConditions.push(`life_events:=[${quote(for_facets.life_event)}]`);
    if (for_facets.category) filterConditions.push(`categories:=[${quote(for_facets.category)}]`);
    if (for_facets.provider) filterConditions.push(`provider:=${quote(for_facets.provider)}`);
    if (for_facets.state && for_facets.state !== 'National') filterConditions.push(`states:=[${quote(for_facets.state)}]`);

    const searchParams = {
      q: query,
      query_by: 'title,content_text',
      facet_by: 'life_events,categories,provider,states',
      filter_by: filterConditions.length > 0 ? filterConditions.join(' && ') : undefined,
      per_page: 0  // Only need facets
    };

    const response = await typesenseClient
      .collections('content_fragments')
      .documents()
      .search(searchParams);

    res.json({
      life_events: response.facet_counts?.find(f => f.field_name === 'life_events')?.counts || [],
      categories: response.facet_counts?.find(f => f.field_name === 'categories')?.counts || [],
      providers: response.facet_counts?.find(f => f.field_name === 'provider')?.counts || [],
      states: response.facet_counts?.find(f => f.field_name === 'states')?.counts || []
    });

  } catch (error) {
    console.error('V2 Facets error:', error);
    res.status(500).json({ error: error.message });
  }
});

// V2.3: get_content_by_facets - Pure facet-based retrieval (no text search)
app.post('/v2/content', async (req, res) => {
  try {
    const { facets = {}, per_page = 50, page = 1, sort_by = 'popularity_sort:asc' } = req.body;

    // Build filter conditions
    const filterConditions = [];
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

    if (facets.life_event) filterConditions.push(`life_events:=[${quote(facets.life_event)}]`);
    if (facets.category) filterConditions.push(`categories:=[${quote(facets.category)}]`);
    if (facets.provider) filterConditions.push(`provider:=${quote(facets.provider)}`);
    if (facets.state && facets.state !== 'National') filterConditions.push(`states:=[${quote(facets.state)}]`);

    if (filterConditions.length === 0) {
      return res.status(400).json({ error: 'At least one facet filter is required' });
    }

    const searchParams = {
      q: '*',
      query_by: 'title',
      filter_by: filterConditions.join(' && '),
      sort_by,
      per_page: parseInt(per_page, 10),
      page: parseInt(page, 10),
      include_fields: 'id,url,title,content_text,life_events,categories,states,provider,component_type'
    };

    const response = await typesenseClient
      .collections('content_fragments')
      .documents()
      .search(searchParams);

    res.json({
      results: response.hits?.map(h => h.document) || [],
      found: response.found || 0,
      page: response.page || 1,
      total_pages: Math.ceil((response.found || 0) / parseInt(per_page, 10))
    });

  } catch (error) {
    console.error('V2 Content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// V2.4: verify_entity_exists - Check if named entity exists
app.post('/v2/verify-entity', async (req, res) => {
  try {
    const { entity_name, entity_type, facets = {} } = req.body;

    if (!entity_name) {
      return res.status(400).json({ error: 'entity_name is required' });
    }

    // Build filter conditions
    const filterConditions = [];
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

    if (facets.life_event) filterConditions.push(`life_events:=[${quote(facets.life_event)}]`);
    if (facets.category) filterConditions.push(`categories:=[${quote(facets.category)}]`);
    if (facets.provider) filterConditions.push(`provider:=${quote(facets.provider)}`);
    if (facets.state && facets.state !== 'National') filterConditions.push(`states:=[${quote(facets.state)}]`);

    // Search for entity in title and content
    const searchParams = {
      q: entity_name,
      query_by: 'title,content_text',
      filter_by: filterConditions.length > 0 ? filterConditions.join(' && ') : undefined,
      per_page: 10,
      prefix: false,
      num_typos: 1
    };

    const response = await typesenseClient
      .collections('content_fragments')
      .documents()
      .search(searchParams);

    const matches = response.hits?.map(hit => ({
      id: hit.document.id,
      title: hit.document.title,
      provider: hit.document.provider,
      url: hit.document.url,
      match_type: hit.document.title?.toLowerCase().includes(entity_name.toLowerCase()) ? 'exact' : 'partial',
      relevance_score: hit.text_match / 100000000  // Normalize Typesense score
    })) || [];

    // Extract suggested facets from top match
    let suggested_facets = {};
    if (matches.length > 0 && response.hits[0].document) {
      const topDoc = response.hits[0].document;
      if (topDoc.provider) suggested_facets.provider = topDoc.provider;
      if (topDoc.life_events?.length > 0) suggested_facets.life_event = topDoc.life_events[0];
      if (topDoc.categories?.length > 0) suggested_facets.category = topDoc.categories[0];
    }

    res.json({
      exists: matches.length > 0,
      matches,
      suggested_facets
    });

  } catch (error) {
    console.error('V2 Verify Entity error:', error);
    res.status(500).json({ error: error.message });
  }
});

// V2.5: ground_claim - Evidence-based claim verification
app.post('/v2/ground-claim', async (req, res) => {
  try {
    const { claim, focus_entity, facets = {}, max_evidence = 5 } = req.body;

    if (!claim) {
      return res.status(400).json({ error: 'claim is required' });
    }

    // Build filter conditions
    const filterConditions = [];
    const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

    if (facets.life_event) filterConditions.push(`life_events:=[${quote(facets.life_event)}]`);
    if (facets.category) filterConditions.push(`categories:=[${quote(facets.category)}]`);
    if (facets.provider) filterConditions.push(`provider:=${quote(facets.provider)}`);
    if (facets.state && facets.state !== 'National') filterConditions.push(`states:=[${quote(facets.state)}]`);

    // Extract key terms from claim for search
    const searchQuery = focus_entity || claim;

    const searchParams = {
      q: searchQuery,
      query_by: 'title,content_text',
      filter_by: filterConditions.length > 0 ? filterConditions.join(' && ') : undefined,
      per_page: Math.max(max_evidence * 2, 10),  // Get more to analyze
      num_typos: 2,
      include_fields: 'id,title,content_text,url,provider'
    };

    const response = await typesenseClient
      .collections('content_fragments')
      .documents()
      .search(searchParams);

    // Simple claim grounding logic (keyword overlap)
    // TODO: Replace with semantic similarity when embeddings are added
    const claimLower = claim.toLowerCase();
    const claimTerms = claimLower.split(/\s+/).filter(t => t.length > 3);

    const evidence = [];
    let supportCount = 0;
    let contradictCount = 0;

    for (const hit of response.hits || []) {
      const doc = hit.document;
      const contentLower = (doc.title + ' ' + doc.content_text).toLowerCase();

      // Calculate term overlap
      const matchingTerms = claimTerms.filter(term => contentLower.includes(term));
      const overlapRatio = matchingTerms.length / claimTerms.length;

      if (overlapRatio > 0.3) {  // At least 30% overlap
        // Extract relevant excerpt
        const sentences = doc.content_text.split(/[.!?]+/);
        const relevantSentences = sentences.filter(s =>
          claimTerms.some(term => s.toLowerCase().includes(term))
        ).slice(0, 2);

        const excerpt = relevantSentences.join('. ').trim().substring(0, 300);

        evidence.push({
          fragment_id: doc.id,
          text_excerpt: excerpt || doc.content_text.substring(0, 300),
          url: doc.url,
          relevance_score: overlapRatio,
          highlights: matchingTerms
        });

        supportCount++;
      }
    }

    // Limit evidence to max_evidence
    evidence.sort((a, b) => b.relevance_score - a.relevance_score);
    const topEvidence = evidence.slice(0, max_evidence);

    // Determine verdict and confidence
    let verdict = 'not_found';
    let confidence = 0;
    let reasoning = '';

    if (topEvidence.length === 0) {
      verdict = 'not_found';
      confidence = 0;
      reasoning = 'No relevant content found to verify this claim';
    } else if (topEvidence.length >= 2 && topEvidence[0].relevance_score > 0.5) {
      verdict = 'supported';
      confidence = Math.min(0.95, topEvidence[0].relevance_score + (topEvidence.length * 0.1));
      reasoning = `Found ${topEvidence.length} fragments with relevant content`;
    } else if (topEvidence.length === 1) {
      verdict = 'ambiguous';
      confidence = topEvidence[0].relevance_score;
      reasoning = 'Limited evidence found - single source';
    } else {
      verdict = 'ambiguous';
      confidence = 0.5;
      reasoning = 'Multiple sources with partial matches';
    }

    res.json({
      verdict,
      confidence: Math.round(confidence * 100) / 100,
      evidence: topEvidence,
      reasoning
    });

  } catch (error) {
    console.error('V2 Ground Claim error:', error);
    res.status(500).json({ error: error.message });
  }
});

// V2.6: get_fragment_context - Get full context for GraphRAG
app.post('/v2/fragment-context', async (req, res) => {
  try {
    const {
      fragment_id,
      include_hierarchy = true,
      include_page_siblings = true,
      include_related_pages = true
    } = req.body;

    if (!fragment_id) {
      return res.status(400).json({ error: 'fragment_id is required' });
    }

    // Get the fragment
    const fragment = await typesenseClient
      .collections('content_fragments')
      .documents(fragment_id)
      .retrieve();

    const result = {
      fragment,
      page_url: fragment.page_url || fragment.url,
      hierarchy: [],
      page_facets: {
        life_events: fragment.life_events || [],
        categories: fragment.categories || [],
        states: fragment.states || []
      },
      siblings: [],
      related_pages: []
    };

    // Build hierarchy from fragment
    if (include_hierarchy) {
      const hierarchy = [];
      if (fragment.hierarchy_lvl0) hierarchy.push(fragment.hierarchy_lvl0);
      if (fragment.hierarchy_lvl1) hierarchy.push(fragment.hierarchy_lvl1);
      if (fragment.hierarchy_lvl2) hierarchy.push(fragment.hierarchy_lvl2);
      result.hierarchy = hierarchy;
    }

    // Get siblings from same page
    if (include_page_siblings && fragment.page_url) {
      const siblingsResponse = await typesenseClient
        .collections('content_fragments')
        .documents()
        .search({
          q: '*',
          query_by: 'title',
          filter_by: `page_url:="${fragment.page_url.replace(/"/g, '\\"')}"`,
          per_page: 20,
          include_fields: 'id,title,hierarchy_lvl0,hierarchy_lvl1,hierarchy_lvl2'
        });

      result.siblings = siblingsResponse.hits?.map(h => h.document).filter(d => d.id !== fragment_id) || [];
    }

    // Get related pages by taxonomy overlap
    if (include_related_pages && fragment.life_events?.length > 0) {
      const relatedResponse = await typesenseClient
        .collections('content_fragments')
        .documents()
        .search({
          q: '*',
          query_by: 'title',
          filter_by: `life_events:=[${fragment.life_events[0]}]`,
          per_page: 10,
          include_fields: 'page_url,title,life_events,categories'
        });

      // Group by unique page URLs
      const pageMap = new Map();
      relatedResponse.hits?.forEach(hit => {
        const doc = hit.document;
        if (doc.page_url && doc.page_url !== fragment.page_url) {
          if (!pageMap.has(doc.page_url)) {
            pageMap.set(doc.page_url, {
              url: doc.page_url,
              title: doc.title,
              shared_facets: {
                life_events: doc.life_events?.filter(le => fragment.life_events?.includes(le)) || [],
                categories: doc.categories?.filter(cat => fragment.categories?.includes(cat)) || []
              },
              similarity_score: 0.5  // Placeholder for now
            });
          }
        }
      });

      result.related_pages = Array.from(pageMap.values()).slice(0, 5);
    }

    res.json(result);

  } catch (error) {
    console.error('V2 Fragment Context error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
async function main() {
  console.log("Starting MyGov MCP Server...");
  
  // Test Typesense connection
  try {
    await typesenseClient.collections().retrieve();
    console.log("✅ Connected to Typesense");
  } catch (error) {
    console.error("❌ Failed to connect to Typesense:", error.message);
    process.exit(1);
  }

  // Start HTTP bridge for internal API communication
  const HTTP_PORT = process.env.HTTP_PORT || 8081;
  app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP bridge running on port ${HTTP_PORT}`);
  });

  // Start MCP stdio server for external model communication
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("🚀 MCP Server running on stdio for external models");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
