// api/utils/relational-queries.js
// Relational query helpers for fragment -> page -> life event -> graph relationships

const fs = require('fs');
const path = require('path');

const taxonomyModulePath = (() => {
  const candidates = [
    process.env.SCRAPER_TAXONOMIES_PATH,
    path.join(__dirname, '..', '..', 'scraper', 'taxonomies'),
    path.join(__dirname, '..', 'scraper', 'taxonomies'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) || fs.existsSync(`${candidate}.js`)) {
      return candidate;
    }
  }

  return candidates[0];
})();

const { loadLifeEventsGraph } = require(taxonomyModulePath);

class RelationalQueries {
  constructor(typesenseClient) {
    this.typesense = typesenseClient;
    this.graphCache = null;
  }

  async getLifeEventsGraph() {
    if (!this.graphCache) {
      this.graphCache = await loadLifeEventsGraph();
    }
    return this.graphCache;
  }

  /**
   * Get life events for fragments via page relationship
   * @param {string[]} fragmentIds 
   * @returns {Object} Map of fragmentId -> life_events[]
   */
  async getFragmentLifeEvents(fragmentIds) {
    // Get fragments with their page URLs
    const fragments = await this.typesense
      .collections('content_fragments')
      .documents()
      .search({
        q: '*',
        filter_by: `id:[${fragmentIds.map(id => `"${id}"`).join(',')}]`,
        include_fields: 'id,page_url',
        per_page: fragmentIds.length
      });

    // Get unique page URLs
    const pageUrls = [...new Set(fragments.hits.map(h => h.document.page_url).filter(Boolean))];
    
    if (pageUrls.length === 0) return {};

    // Get pages with their life events
    const pages = await this.typesense
      .collections('content_pages')
      .documents()
      .search({
        q: '*',
        filter_by: `url:[${pageUrls.map(url => `"${url}"`).join(',')}]`,
        include_fields: 'url,life_events,primary_life_event,stage,stage_variant',
        per_page: pageUrls.length
      });

    // Build page URL -> life events map
    const pageLifeEvents = {};
    pages.hits.forEach(hit => {
      pageLifeEvents[hit.document.url] = {
        life_events: hit.document.life_events || [],
        primary_life_event: hit.document.primary_life_event,
        stage: hit.document.stage,
        stage_variant: hit.document.stage_variant
      };
    });

    // Map fragments to life events via pages
    const result = {};
    fragments.hits.forEach(hit => {
      const pageUrl = hit.document.page_url;
      result[hit.document.id] = pageLifeEvents[pageUrl] || { life_events: [] };
    });

    return result;
  }

  /**
   * Get graph relationships for life events
   * @param {string[]} lifeEvents 
   * @returns {Object} Graph data with relationships
   */
  async getLifeEventRelationships(lifeEvents) {
    const graph = await this.getLifeEventsGraph();
    const relationships = {};

    lifeEvents.forEach(eventName => {
      const graphEvent = graph.find(ge => ge.event_name === eventName);
      if (graphEvent) {
        relationships[eventName] = {
          prerequisites: this._resolveEventIds(graph, graphEvent.prerequisites || []),
          next_states: this._resolveEventIds(graph, graphEvent.next_states || []),
          frequent_concurrents: this._resolveEventIds(graph, graphEvent.frequent_concurrents || []),
          concurrent_disallowed: this._resolveEventIds(graph, graphEvent.concurrent_disallowed || []),
          eligibility_status: graphEvent.eligibility_status,
          typical_age_range: graphEvent.typical_age_range,
          typical_duration_days: graphEvent.typical_duration_days,
          cluster: graphEvent.cluster,
          event_type: graphEvent.event_type
        };
      }
    });

    return relationships;
  }

  /**
   * Search fragments by life event with full relational context
   */
  async searchFragmentsByLifeEvent(lifeEvent, options = {}) {
    const { per_page = 20, page = 1 } = options;

    // First find pages with this life event
    const pagesResult = await this.typesense
      .collections('content_pages')
      .documents()
      .search({
        q: '*',
        filter_by: `life_events:=[${JSON.stringify(lifeEvent)}]`,
        include_fields: 'url,life_events,primary_life_event,stage,stage_variant',
        per_page: 100 // Get many pages to have fragment options
      });

    if (pagesResult.hits.length === 0) {
      return { fragments: [], pages: [], relationships: {} };
    }

    // Get page URLs for fragment filtering
    const pageUrls = pagesResult.hits.map(h => h.document.url);
    
    // Search fragments from these pages
    const fragmentsResult = await this.typesense
      .collections('content_fragments')
      .documents()
      .search({
        q: '*',
        filter_by: `page_url:[${pageUrls.map(url => `"${url}"`).join(',')}]`,
        sort_by: 'popularity_sort:asc',
        page,
        per_page
      });

    // Get relationship data for this life event
    const relationships = await this.getLifeEventRelationships([lifeEvent]);

    return {
      fragments: fragmentsResult.hits.map(h => h.document),
      pages: pagesResult.hits.map(h => h.document),
      relationships: relationships[lifeEvent] || {},
      found: fragmentsResult.found,
      page_found: pagesResult.found
    };
  }

  /**
   * Get prerequisites chain for a life event
   */
  async getPrerequisitesChain(lifeEvent, maxDepth = 3) {
    const graph = await this.getLifeEventsGraph();
    const visited = new Set();
    const chain = [];

    const traverse = (eventName, depth) => {
      if (depth >= maxDepth || visited.has(eventName)) return;
      visited.add(eventName);

      const graphEvent = graph.find(ge => ge.event_name === eventName);
      if (graphEvent) {
        chain.push({
          event_name: eventName,
          depth,
          prerequisites: this._resolveEventIds(graph, graphEvent.prerequisites || [])
        });

        // Recurse into prerequisites
        (graphEvent.prerequisites || []).forEach(prereqId => {
          const prereqEvent = graph.find(ge => ge.id === prereqId);
          if (prereqEvent) {
            traverse(prereqEvent.event_name, depth + 1);
          }
        });
      }
    };

    traverse(lifeEvent, 0);
    return chain;
  }

  /**
   * Helper to resolve event IDs to names
   */
  _resolveEventIds(graph, eventIds) {
    return eventIds
      .map(id => graph.find(ge => ge.id === id))
      .filter(Boolean)
      .map(ge => ge.event_name);
  }

  /**
   * Enhanced search that includes related life events via graph
   */
  async searchWithRelatedLifeEvents(query, targetLifeEvent, options = {}) {
    const relationships = await this.getLifeEventRelationships([targetLifeEvent]);
    const rel = relationships[targetLifeEvent];
    
    if (!rel) {
      return this.searchFragmentsByLifeEvent(targetLifeEvent, options);
    }

    // Include related life events in search
    const allRelatedEvents = [
      targetLifeEvent,
      ...rel.prerequisites,
      ...rel.next_states,
      ...rel.frequent_concurrents
    ];

    // Find pages for any related life events
    const pagesResult = await this.typesense
      .collections('content_pages')
      .documents()
      .search({
        q: '*',
        filter_by: `life_events:[${allRelatedEvents.map(e => `"${e}"`).join(',')}]`,
        include_fields: 'url,life_events,primary_life_event,stage,stage_variant',
        per_page: 200
      });

    // Weight pages by relationship type
    const pageWeights = {};
    pagesResult.hits.forEach(hit => {
      const pageEvents = hit.document.life_events || [];
      let weight = 0;
      
      if (pageEvents.includes(targetLifeEvent)) weight += 10; // Primary target
      pageEvents.forEach(event => {
        if (rel.prerequisites.includes(event)) weight += 3;
        if (rel.next_states.includes(event)) weight += 2;
        if (rel.frequent_concurrents.includes(event)) weight += 1;
      });
      
      pageWeights[hit.document.url] = weight;
    });

    // Get fragments from weighted pages
    const pageUrls = Object.keys(pageWeights);
    if (pageUrls.length === 0) {
      return { fragments: [], pages: [], relationships: rel };
    }

    const fragmentsResult = await this.typesense
      .collections('content_fragments')
      .documents()
      .search({
        q: query || '*',
        filter_by: `page_url:[${pageUrls.map(url => `"${url}"`).join(',')}]`,
        query_by: 'title,content_text,search_keywords',
        sort_by: 'popularity_sort:asc',
        ...options
      });

    // Add relationship scores to results
    const enrichedFragments = fragmentsResult.hits.map(hit => ({
      ...hit.document,
      _relationship_score: pageWeights[hit.document.page_url] || 0
    }));

    return {
      fragments: enrichedFragments,
      pages: pagesResult.hits.map(h => h.document),
      relationships: rel,
      found: fragmentsResult.found,
      related_events: allRelatedEvents
    };
  }
}

module.exports = RelationalQueries;
