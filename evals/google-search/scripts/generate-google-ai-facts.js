#!/usr/bin/env node

/**
 * Helper script to bootstrap expected facts for Google AI summary evals
 * by mining the current Typesense fragments for each search term sample.
 */

const fs = require('fs').promises;
const path = require('path');
const { loadSamples } = require('../../run-eval');

const TYPESENSE_HOST = process.env.TYPESENSE_HOST || 'localhost';
const TYPESENSE_PORT = process.env.TYPESENSE_PORT || '8108';
const TYPESENSE_PROTOCOL = process.env.TYPESENSE_PROTOCOL || 'http';
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || 'xyz123abc';
const TYPESENSE_COLLECTION = process.env.TYPESENSE_COLLECTION || 'content_fragments';

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sample';
}

function buildFilter(facets = {}) {
  const clauses = [];
  const quote = value => `"${value.replace(/"/g, '\\"')}"`;

  if (facets.provider) clauses.push(`provider:=${quote(facets.provider)}`);
  if (facets.life_event) clauses.push(`life_events:=${quote(facets.life_event)}`);
  if (facets.category) clauses.push(`categories:=${quote(facets.category)}`);
  if (facets.state) clauses.push(`states:=${quote(facets.state)}`);

  return clauses.join(' && ');
}

async function searchFragments(query, facets) {
  const body = {
    q: query || '*',
    query_by: 'title,content_text',
    per_page: 8,
    include_fields: 'id,url,title,content_text,provider,life_events,categories,states,hierarchy_lvl0',
    highlight: false,
    sort_by: '_text_match:desc'
  };

  const filterBy = buildFilter(facets);
  if (filterBy) {
    body.filter_by = filterBy;
  }

  const url = `${TYPESENSE_PROTOCOL}://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections/${TYPESENSE_COLLECTION}/documents/search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Typesense search failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const hits = data.hits || [];
  return hits.map(hit => hit.document).filter(Boolean);
}

function extractSentences(text) {
  return (text || '')
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 40 && sentence.length <= 280);
}

function scoreSentence(sentence) {
  if (!sentence) return 0;
  let score = 0;
  if (/[0-9]/.test(sentence)) score += 2;
  if (/(weeks?|months?|payments?|eligible|must|provide|access|online)/i.test(sentence)) score += 1.5;
  if (/\baustralia\b/i.test(sentence)) score += 0.5;
  if (sentence.length > 160) score -= 0.5;
  return score;
}

function extractFactsFromFragment(fragment, maxFacts = 5) {
  const sentences = extractSentences(fragment.content_text || '');
  const scored = sentences
    .map(text => ({ text, score: scoreSentence(text) }))
    .filter(entry => entry.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFacts);

  return scored.map(entry => ({
    text: entry.text,
    score: Number(entry.score.toFixed(2)),
    fragment_id: fragment.id,
    url: fragment.url,
    provider: fragment.provider,
    hierarchy: fragment.hierarchy_lvl0
  }));
}

async function generateFacts() {
  const samples = await loadSamples('google-search-ai');
  const generatedDir = path.join(__dirname, '..', '..', 'registry', 'data', 'google-search-ai', 'generated');
  await fs.mkdir(generatedDir, { recursive: true });

  for (const sample of samples) {
    const slug = sample.capture_slug || slugify(sample.search_term);
    try {
      const fragments = await searchFragments(sample.search_term, sample.facets || {});
      if (!fragments.length) {
        console.warn(`⚠️  No fragments found for "${sample.search_term}"`);
        continue;
      }

      const fragmentSummaries = fragments.map(fragment => ({
        id: fragment.id,
        title: fragment.title,
        provider: fragment.provider,
        hierarchy: fragment.hierarchy_lvl0,
        url: fragment.url
      }));

      const candidateFacts = fragments.flatMap(fragment => extractFactsFromFragment(fragment));
      const uniqueFacts = [];
      const seen = new Set();
      for (const fact of candidateFacts) {
        const key = fact.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueFacts.push(fact);
      }

      const payload = {
        generated_at: new Date().toISOString(),
        search_term: sample.search_term,
        facets: sample.facets || {},
        fragments: fragmentSummaries,
        candidate_facts: uniqueFacts
      };

      const outPath = path.join(generatedDir, `${slug}.json`);
      await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
      console.log(`✓ Saved ${uniqueFacts.length} candidate facts for ${sample.search_term} -> ${outPath}`);
    } catch (error) {
      console.error(`❌ Failed to process ${sample.search_term}:`, error.message);
    }
  }
}

if (require.main === module) {
  generateFacts().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { generateFacts };
