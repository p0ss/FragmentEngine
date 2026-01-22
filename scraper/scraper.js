// scraper/scraper.js
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const crypto = require('crypto');
const pLimit = require('p-limit');
const robotsParser = require('robots-parser');
const Typesense = require('typesense');
const fetch = require('node-fetch'); // Add this import
const { extractFragment } = require('./extractors');
const { enrichWithTaxonomy } = require('./taxonomies');
const { contentFragmentSchema, contentPageSchema } = require('../config/typesense-schema');
const { fetchSitemapUrls } = require('./sitemap');
const ScraperMonitor = require('./monitor');

const CRAWL_VERSION = Math.floor(Date.now() / 1000); // Unix timestamp in seconds, fits in int32
const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 5;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class MyGovScraper {
  constructor(cfg) {
    this.cfg = cfg;
    this.typesense = new Typesense.Client({
      nodes: [{
        host: process.env.TYPESENSE_HOST || 'localhost',
        port: parseInt(process.env.TYPESENSE_PORT || '8108', 10),
        protocol: 'http'
      }],
      apiKey: process.env.TYPESENSE_API_KEY || 'xyz123abc',
      connectionTimeoutSeconds: 10
    });
    this.limit = pLimit(CONCURRENCY);
    this.visited = new Set();
    this.fragments = [];
    this.requestCount = 0;
    this.startTime = Date.now();
    this.monitor = new ScraperMonitor();
    this.targetHost = null; // Set during run() for host-specific pruning
    this.pendingCrawls = []; // Track all crawl promises for proper completion
  }

  async prepareCollection() {
    const collName = contentFragmentSchema.name;
    try {
      const info = await this.typesense.collections(collName).retrieve();
      const numDocs = info?.num_documents ?? 'unknown';
      const fieldsCount = Array.isArray(info?.fields) ? info.fields.length : 'unknown';
      console.log(`Collection exists, ready for upsert (documents: ${numDocs}, fields: ${fieldsCount})`);

      // Ensure required fields exist (migrations for new fields)
      const existingFieldNames = new Set((info.fields || []).map(f => f.name));
      const missingFields = (contentFragmentSchema.fields || []).filter(f => !existingFieldNames.has(f.name));
      if (missingFields.length > 0) {
        console.log('Adding missing fields to collection:', missingFields.map(f => f.name).join(', '));
        try {
          await this.typesense.collections(collName).update({ fields: missingFields });
          console.log('✅ Collection fields updated.');
        } catch (e) {
          console.warn('⚠️ Failed to update collection fields:', e.message);
        }
      }
    } catch (_) {
      console.log('Creating new collection...');
      await this.typesense.collections().create(contentFragmentSchema);
    }
    // Ensure pages collection exists and is up-to-date
    const pagesColl = contentPageSchema.name;
    try {
      const info = await this.typesense.collections(pagesColl).retrieve();
      const existingFieldNames = new Set((info.fields || []).map(f => f.name));
      const missingFields = (contentPageSchema.fields || []).filter(f => !existingFieldNames.has(f.name));
      if (missingFields.length > 0) {
        console.log('Adding missing fields to pages collection:', missingFields.map(f => f.name).join(', '));
        try {
          await this.typesense.collections(pagesColl).update({ fields: missingFields });
          console.log('✅ Pages collection fields updated.');
        } catch (e) {
          console.warn('⚠️ Failed to update pages collection fields:', e.message);
        }
      }
    } catch (_) {
      console.log('Creating new pages collection...');
      await this.typesense.collections().create(contentPageSchema);
    }
  }

  async run(startUrl) {
    // Extract target host for host-specific pruning
    try {
      this.targetHost = new URL(startUrl).hostname;
      console.log(`Target host for this crawl: ${this.targetHost}`);
    } catch (e) {
      console.warn('Could not extract host from startUrl:', e.message);
    }

    await this.prepareCollection();

    const launchArgsBase = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const launchOpts = { headless: 'new', args: launchArgsBase, executablePath: execPath };
    console.log('Launching headless Chrome with options:', JSON.stringify({ args: launchArgsBase, executablePath: execPath }));

    const withTimeout = (p, ms, label) => {
      return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms))
      ]);
    };

    let browser;
    try {
      browser = await withTimeout(puppeteer.launch(launchOpts), 30000, 'Chrome launch');
    } catch (e1) {
      console.warn('Initial Chrome launch failed:', e1.message);
      const fallbackArgs = [...launchArgsBase, '--no-zygote', '--single-process'];
      const fallbackOpts = { headless: 'new', args: fallbackArgs, executablePath: execPath };
      console.log('Retrying Chrome launch with fallback options:', JSON.stringify({ args: fallbackArgs, executablePath: execPath }));
      browser = await withTimeout(puppeteer.launch(fallbackOpts), 45000, 'Chrome fallback launch');
    }
    const ver = await browser.version().catch(() => 'unknown');
    console.log('✅ Headless Chrome launched (version:', ver, ')');
    
    try {
      console.log('Fetching robots.txt and sitemap for target:', startUrl);
      const robots = await this.fetchRobots(startUrl);
      
      // Try sitemap first
      const sitemapUrls = await fetchSitemapUrls(startUrl);
      if (sitemapUrls.length > 0) {
        console.log(`Found ${sitemapUrls.length} URLs from sitemap for ${startUrl}`);
        // Crawl sitemap URLs with higher priority
        await Promise.all(
          sitemapUrls.slice(0, this.cfg.maxPages).map(url => 
            this.limit(() => this.crawl(browser, url, robots, 0))
          )
        );
      }
      
      // Then crawl normally from start URL
      await this.crawl(browser, startUrl, robots);

      // Wait for all queued child crawls to complete (including newly added ones)
      // Keep waiting until no new crawls are being added
      let waitedCount = 0;
      while (this.pendingCrawls.length > waitedCount) {
        const currentCount = this.pendingCrawls.length;
        console.log(`Waiting for ${currentCount - waitedCount} queued crawls to complete (${waitedCount} already done, ${currentCount} total)...`);
        await Promise.all(this.pendingCrawls.slice(waitedCount));
        waitedCount = currentCount;
      }
      console.log(`All ${waitedCount} crawls complete`);

      await this.indexFragments();
      await this.pruneStaleDocs();
      
      // Print final report
      console.log('Crawl complete!', this.monitor.getReport());
    } finally {
      await browser.close();
    }
  }

  async fetchRobots(seed) {
    const robotsUrl = new URL('/robots.txt', seed).href;
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
        'Accept': 'text/plain,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
        'Connection': 'keep-alive'
      };
      const res = await fetch(robotsUrl, { timeout: 10000, redirect: 'follow', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      console.log(`robots.txt loaded from ${robotsUrl} (${body.length} bytes)`);
      return robotsParser(robotsUrl, body);
    } catch (e) {
      console.warn(`robots.txt unavailable at ${robotsUrl}: ${e.message}. Proceeding without restrictions.`);
      return { isAllowed: () => true };
    }
  }

  async crawl(browser, url, robots, depth = 0, retries = 3) {
    if (this.visited.has(url) || depth > this.cfg.maxDepth || !robots.isAllowed(url, '*')) {
      return;
    }
    
    // Rate limiting
    this.requestCount++;
    if (this.requestCount % 10 === 0) {
      const elapsed = Date.now() - this.startTime;
      const rps = this.requestCount / (elapsed / 1000);
      console.log(`Crawl rate: ${rps.toFixed(2)} req/s`);
      
      // Throttle if too fast
      if (rps > 5) {
        await delay(200);
      }
    }
    
    this.visited.add(url);
    console.log(`Crawling: ${url} (depth: ${depth})`);

    const page = await browser.newPage();
    const crawlStart = Date.now();
    
    try {
      await page.setRequestInterception(true);
      
      // Block unnecessary resources for faster crawling
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      console.log(`  [${url}] Loading page...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`  [${url}] Page loaded, waiting for content...`);

      // Wait for main content
      await page.waitForSelector('main, #main-content, .main-content, article', { timeout: 5000 }).catch(() => {});
      console.log(`  [${url}] Extracting content...`);

      const html = await page.content();
      const $ = cheerio.load(html);
      const frags = await this.extractFragments($, url, page);
      this.fragments.push(...frags);
      console.log(`  [${url}] Extracted ${frags.length} fragments`);

      this.monitor.recordCrawl(url, true, Date.now() - crawlStart);
      this.monitor.stats.fragmentsExtracted += frags.length;

      if (depth < this.cfg.maxDepth) {
        console.log(`  [${url}] Extracting links...`);
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .map(a => ({ href: a.href, text: a.textContent }))
        );

        // Get the current page's origin for filtering
        const currentOrigin = new URL(url).origin;

        // Filter and prioritize links
        const priorityLinks = links
          .filter(l => {
            try {
              const linkUrl = new URL(l.href);
              return linkUrl.origin === currentOrigin &&
                     !l.href.match(/\.(pdf|doc|docx|xls|xlsx)$/i) &&
                     !l.href.includes('#') &&
                     !this.cfg.excludePatterns.some(pattern => pattern.test(l.href));
            } catch {
              return false;
            }
          })
          .sort((a, b) => {
            const aScore = this.scoreLinkRelevance(a.text);
            const bScore = this.scoreLinkRelevance(b.text);
            return bScore - aScore;
          })
          .slice(0, this.cfg.maxLinksPerPage)
          .map(l => l.href);

        console.log(`  [${url}] Found ${priorityLinks.length} links to follow`);

        // Queue child crawls WITHOUT awaiting - prevents deadlock with concurrency limit
        // Track promises so we can wait for completion before indexing
        priorityLinks.forEach(link => {
          const crawlPromise = this.limit(() => this.crawl(browser, link, robots, depth + 1));
          this.pendingCrawls.push(crawlPromise);
        });
      }
    } catch (e) {
      console.error(`Crawl error (${retries} retries left)`, url, e.message);
      this.monitor.recordCrawl(url, false, Date.now() - crawlStart);
      
      if (retries > 0) {
        await delay(1000);
        return this.crawl(browser, url, robots, depth, retries - 1);
      }
    } finally {
      await page.close();
    }
  }

  scoreLinkRelevance(linkText) {
    const keywords = ['service', 'eligibility', 'apply', 'benefit', 'support', 'help', 'information'];
    const text = (linkText || '').toLowerCase();
    return keywords.filter(k => text.includes(k)).length;
  }

  async extractFragments($, url, page) {
    const fragments = [];
    
    try {
      const pageTitle = $('title').text() || '';
      const breadcrumbs = this.extractBreadcrumbs($);
    
      // Extract main content area
      const mainSelectors = ['main', '#main-content', '.main-content', 'article'];
      let $main = null;
      
      for (const selector of mainSelectors) {
        if ($(selector).length) {
          $main = $(selector).first();
          break;
        }
      }
      
      if (!$main) {
        $main = $('body');
      }

      // Find all headings and their content
      const headings = $main.find('h1, h2, h3, h4').toArray();
      
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const $heading = $(heading);
        const nextHeading = headings[i + 1];
        
        // Get content between this heading and the next
        let $content = $heading.nextUntil(
          nextHeading ? $(nextHeading) : undefined,
          'p, ul, ol, div.content, .info-box, table, form'
        );
        
        if ($content.length === 0 && $heading.parent().is('div, section, article')) {
          // Try getting siblings within the same container
          const $container = $heading.parent();
          const siblings = $container.children().not('h1, h2, h3, h4').toArray();
          siblings.forEach(elem => {
            $content = $content.add(elem);
          });
        }

        if ($content.length > 0 || $heading.is('h1')) {
          try {
            const fragment = await extractFragment({
              $heading,
              $content,
              $,
              url,
              breadcrumbs,
              pageTitle,
              page
            });
            
            if (fragment) {
              // Enrich with taxonomy
              const enrichedFragment = await enrichWithTaxonomy(fragment);
              
              // Add versioning fields
              const finalFragment = {
                ...enrichedFragment,
                crawl_version: CRAWL_VERSION,
                last_seen_at: Date.now(),
                popularity_sort: 100 - (enrichedFragment.popularity_score || 0),
                page_url: baseUrl(url)
              };
              
              fragments.push(finalFragment);
            }
          } catch (fragmentError) {
            console.error(`Error processing fragment in ${url}:`, fragmentError.message);
            // Continue with other fragments
          }
        }
      }

      // Also extract any standalone important sections
      const standaloneSelectors = [
        '.alert', '.warning-box', '.info-panel',
        '[role="alert"]', '.checklist', '.step-list'
      ];
      
      for (const selector of standaloneSelectors) {
        try {
          const elements = $main.find(selector).toArray();
          for (const elem of elements) {
            const $elem = $(elem);
            
            // Cheerio environment: avoid DOM APIs; extract as standalone fragment
            {
              try {
                const fragment = this.extractStandaloneFragment($elem, url, breadcrumbs);
                if (fragment) {
                  const enrichedFragment = await enrichWithTaxonomy(fragment);
                  fragments.push({
                    ...enrichedFragment,
                    crawl_version: CRAWL_VERSION,
                    last_seen_at: Date.now(),
                    popularity_sort: 100 - (enrichedFragment.popularity_score || 0)
                  });
                }
              } catch (standaloneError) {
                console.error(`Error processing standalone element in ${url}:`, standaloneError.message);
                // Continue with other elements
              }
            }
          }
        } catch (selectorError) {
          console.error(`Error with selector ${selector} in ${url}:`, selectorError.message);
          // Continue with other selectors
        }
      }

      return fragments;
    } catch (error) {
      console.error(`Error in extractFragments for ${url}:`, error.message);
      return fragments; // Return what we have so far
    }
  }

  extractBreadcrumbs($) {
    const breadcrumbs = [];
    
    // Common breadcrumb selectors
    const selectors = [
      '.breadcrumb li',
      'nav[aria-label="breadcrumb"] li',
      '.breadcrumbs li',
      '[class*="breadcrumb"] li'
    ];
    
    for (const selector of selectors) {
      try {
        const $items = $(selector);
        if ($items.length > 0) {
          $items.each((i, item) => {
            const text = $(item).text().trim();
            if (text && text !== '>' && text !== '/') {
              breadcrumbs.push(text);
            }
          });
          break;
        }
      } catch (breadcrumbError) {
        console.log(`Error extracting breadcrumbs with selector ${selector}:`, breadcrumbError.message);
      }
    }
    
    return breadcrumbs;
  }

  extractStandaloneFragment($elem, url, breadcrumbs) {
    const crypto = require('crypto');
    const id = crypto.createHash('md5')
      .update(url + $elem.text())
      .digest('hex');
    
    const title = $elem.find('h1, h2, h3, h4').first().text() || 
                  $elem.attr('aria-label') || 
                  'Important Information';
    
    return {
      id,
      url: `${url}#${id}`,
      title,
      content_text: $elem.text().trim(),
      content_html: $elem.html(),
      site_hierarchy: this.extractSiteHierarchy(url),
      page_hierarchy: breadcrumbs,
      
      // Ensure required hierarchy fields are present
      hierarchy_lvl0: breadcrumbs[breadcrumbs.length - 1] || title || 'Content',
      
      component_type: this.detectComponentType($elem),
      last_modified: new Date().getTime()
    };
  }

  extractSiteHierarchy(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname
        .split('/')
        .filter(part => part.length > 0);
      
      return [urlObj.hostname, ...pathParts];
    } catch {
      return [];
    }
  }

  detectComponentType($elem) {
    if ($elem.is('form') || $elem.find('form').length) return 'form';
    if ($elem.is('table') || $elem.find('table').length) return 'table';
    if ($elem.hasClass('checklist') || $elem.find('ol.steps').length) return 'checklist';
    if ($elem.hasClass('alert') || $elem.is('[role="alert"]')) return 'alert';
    if ($elem.hasClass('info-box') || $elem.hasClass('info-panel')) return 'info_box';
    return 'content';
  }

  async indexFragments() {
    console.log(`Indexing ${this.fragments.length} fragments...`);
    // Debug: log first fragment's keys to verify content_hash is included
    if (this.fragments.length > 0) {
      const sampleFrag = this.fragments[0];
      console.log('Sample fragment keys:', Object.keys(sampleFrag).join(', '));
      console.log('Sample content_hash:', sampleFrag.content_hash ? sampleFrag.content_hash.substring(0, 16) + '...' : 'NULL');
      // Deep debug: check if content_hash is enumerable and accessible
      console.log('content_hash in sampleFrag:', 'content_hash' in sampleFrag);
      console.log('content_hash value type:', typeof sampleFrag.content_hash);
      console.log('JSON.stringify includes content_hash:', JSON.stringify(sampleFrag).includes('content_hash'));
    }
    const coll = this.typesense.collections('content_fragments').documents();
    
    let indexed = 0;
    // Use direct HTTP import to ensure all fields are preserved
    const tsHost = process.env.TYPESENSE_HOST || 'localhost';
    const tsPort = process.env.TYPESENSE_PORT || '8108';
    const tsKey = process.env.TYPESENSE_API_KEY || 'xyz123abc';
    const importUrl = `http://${tsHost}:${tsPort}/collections/content_fragments/documents/import?action=upsert`;

    for (let i = 0; i < this.fragments.length; i += 100) {
      const batch = this.fragments.slice(i, i + 100);
      try {
        // Convert batch to JSONL format
        const jsonl = batch.map(doc => JSON.stringify(doc)).join('\n');

        // Debug: print first document's content_hash before import
        if (i === 0 && batch.length > 0) {
          console.log('Pre-import check - content_hash:', batch[0].content_hash ? batch[0].content_hash.substring(0, 20) + '...' : 'NULL');
        }

        const response = await fetch(importUrl, {
          method: 'POST',
          headers: {
            'X-TYPESENSE-API-KEY': tsKey,
            'Content-Type': 'text/plain'
          },
          body: jsonl
        });

        const resultText = await response.text();
        const results = resultText.split('\n').filter(l => l).map(l => JSON.parse(l));
        const failures = results.filter(r => !r.success);

        if (i === 0) {
          console.log('Import result sample:', JSON.stringify(results.slice(0, 2)));
          if (failures.length > 0) {
            console.log('Import failures:', JSON.stringify(failures.slice(0, 3)));
          }
        }

        indexed += batch.length - failures.length;
        console.log(`Progress: ${indexed}/${this.fragments.length} (${Math.round(indexed/this.fragments.length*100)}%)`);
      } catch (e) {
        console.error('Batch import error:', e);
        // Fallback to individual upserts via Typesense client
        for (const doc of batch) {
          try {
            await coll.upsert(doc);
            indexed++;
          } catch (docErr) {
            console.error(`Failed to index fragment: ${doc.url}`, docErr.message);
          }
        }
      }
    }
    console.log(`Indexing complete: ${indexed} documents`);
  }

  buildPageDocs() {
    const pages = new Map(); // baseUrl -> accum
    for (const f of this.fragments) {
      const page = f.page_url || baseUrl(f.url || '');
      if (!page) continue;
      if (!pages.has(page)) {
        const host = (() => { try { return new URL(page).hostname; } catch { return ''; } })();
        pages.set(page, {
          id: page, // use URL as id for simplicity
          url: page,
          host,
          title: undefined,
          fragment_ids: [],
          fragment_count: 0,
          life_events: new Set(),
          categories: new Set(),
          states: new Set(),
          provider: new Set(),
          governance: new Set(),
          stage: new Set(),
          stage_variant: new Set(),
          content_text: '',
          keywords: new Set(),
          out_links: new Set(),
          out_link_tokens: new Set(),
          _lvl0Counts: new Map()
        });
      }
      const acc = pages.get(page);
      acc.fragment_ids.push(f.id);
      acc.fragment_count++;
      (f.life_events||[]).forEach(x => acc.life_events.add(x));
      (f.categories||[]).forEach(x => acc.categories.add(x));
      (f.states||[]).forEach(x => acc.states.add(x));
      if (f.provider) acc.provider.add(f.provider);
      if (f.governance) acc.governance.add(f.governance);
      if (f.stage) acc.stage.add(f.stage);
      if (f.stage_variant) acc.stage_variant.add(f.stage_variant);
      // Approximate page title as the most frequent hierarchy_lvl0
      const lvl0 = f.hierarchy_lvl0 || f.title || '';
      if (lvl0) acc._lvl0Counts.set(lvl0, (acc._lvl0Counts.get(lvl0) || 0) + 1);
      // Accumulate content (cap for size)
      if (acc.content_text.length < 40000) {
        const add = (f.content_text || '').slice(0, 4000);
        acc.content_text += (acc.content_text ? '\n' : '') + add;
      }
      // Accumulate keywords
      (f.search_keywords || []).forEach(k => acc.keywords.add(k));

      // Extract outbound links from fragment content_html (content area only)
      const html = f.content_html || '';
      const hrefs = Array.from(html.matchAll(/href\s*=\s*"([^"]+)"/gi)).map(m => m[1]);
      for (const h of hrefs) {
        try {
          const u = new URL(h, page);
          if (!['http:', 'https:'].includes(u.protocol)) continue;
          const b = baseUrl(u.toString());
          acc.out_links.add(b);
          const seg = (u.pathname || '/').split('/').filter(Boolean)[0] || '';
          const host = (u.hostname || '').toLowerCase();
          if (host) acc.out_link_tokens.add(host);
          if (host && seg) acc.out_link_tokens.add(`${host}/${seg.toLowerCase()}`);
        } catch { /* ignore invalid URLs */ }
      }
    }
    // Finalize docs
    const docs = [];
    for (const acc of pages.values()) {
      // pick title by max count
      if (acc._lvl0Counts && acc._lvl0Counts.size) {
        acc.title = Array.from(acc._lvl0Counts.entries()).sort((a,b)=>b[1]-a[1])[0][0];
      }
      // build embedding (hashed BOW)
      const emb = buildHashedEmbedding(acc.content_text || '', 256);
      docs.push({
        id: acc.id,
        url: acc.url,
        host: acc.host,
        title: acc.title,
        fragment_ids: acc.fragment_ids,
        fragment_count: acc.fragment_count,
        life_events: Array.from(acc.life_events),
        categories: Array.from(acc.categories),
        states: Array.from(acc.states),
        provider: Array.from(acc.provider),
        governance: Array.from(acc.governance),
        stage: Array.from(acc.stage)[0] || '',
        stage_variant: Array.from(acc.stage_variant)[0] || '',
        content_text: acc.content_text,
        keywords: Array.from(acc.keywords),
        embedding: emb,
        out_links: Array.from(acc.out_links).slice(0, 500),
        out_link_tokens: Array.from(acc.out_link_tokens).slice(0, 1000),
        crawl_version: CRAWL_VERSION,
        last_seen_at: Date.now()
      });
    }
    return docs;
  }

  // Enhanced page building with life event analysis
  async buildPageDocsWithLifeEvents() {
    const { enrichPageWithLifeEvents } = require('./taxonomies');
    const baseDocs = this.buildPageDocs();
    
    console.log(`Enriching ${baseDocs.length} pages with life event analysis...`);
    const enrichedDocs = [];
    
    for (let i = 0; i < baseDocs.length; i++) {
      try {
        const enrichedPage = await enrichPageWithLifeEvents(baseDocs[i]);
        enrichedDocs.push(enrichedPage);
        
        if ((i + 1) % 100 === 0) {
          console.log(`Life event analysis progress: ${i + 1}/${baseDocs.length} (${Math.round((i + 1)/baseDocs.length*100)}%)`);
        }
      } catch (error) {
        console.error(`Error enriching page ${baseDocs[i].url}:`, error);
        // Add page without enrichment as fallback
        enrichedDocs.push({
          ...baseDocs[i],
          life_events: [],
          primary_life_event: '',
          eligibility_statuses: [],
          stage: '',
          stage_variant: ''
        });
      }
    }
    
    return enrichedDocs;
  }

  async indexPages() {
    const docs = await this.buildPageDocsWithLifeEvents();
    console.log(`Indexing ${docs.length} pages with life event analysis...`);
    const coll = this.typesense.collections('content_pages').documents();
    let indexed = 0;
    for (let i = 0; i < docs.length; i += 100) {
      const batch = docs.slice(i, i + 100);
      try {
        await coll.import(batch, { action: 'upsert' });
        indexed += batch.length;
        console.log(`Pages progress: ${indexed}/${docs.length} (${Math.round(indexed/docs.length*100)}%)`);
      } catch (e) {
        console.error('Pages batch import error:', e.message);
        for (const doc of batch) {
          try { await coll.upsert(doc); indexed++; } catch (er) {
            console.error('Failed to index page:', doc.url, er.message);
          }
        }
      }
    }
    console.log(`Pages indexing complete: ${indexed} documents`);
  }

  async pruneStaleDocs() {
    console.log('Pruning stale documents...');

    // Only prune documents from the current target host (not all hosts)
    if (!this.targetHost) {
      console.warn('No target host set - skipping prune to avoid deleting other hosts\' data');
      return;
    }

    // For fragments, filter by URL containing the host
    // Typesense doesn't support LIKE queries, so we use the url field with exact host matching
    const hostPattern = this.targetHost.replace(/\./g, '\\.'); // Escape dots for safety

    try {
      // Prune fragments: match by page_url containing the host
      const result = await this.typesense
        .collections('content_fragments')
        .documents()
        .delete({ filter_by: `crawl_version:<${CRAWL_VERSION} && page_url:*${this.targetHost}*` });
      console.log(`Pruned ${result.num_deleted} stale fragments for ${this.targetHost}`);
    } catch (e) {
      // Typesense may not support wildcard in filter - try alternative approach
      console.warn('Wildcard filter not supported, skipping fragment prune:', e.message);
    }

    try {
      // Prune pages: filter by host field (exact match)
      const result = await this.typesense
        .collections('content_pages')
        .documents()
        .delete({ filter_by: `crawl_version:<${CRAWL_VERSION} && host:=${this.targetHost}` });
      console.log(`Pruned ${result.num_deleted} stale pages for ${this.targetHost}`);
    } catch (e) {
      console.error('Error pruning stale pages:', e.message);
    }
  }
}

// Run the scraper
if (require.main === module) {
  const cfg = require('../config/scraper-config');
  const scraper = new MyGovScraper(cfg);
  const startUrl = process.env.TARGET_URL || 'https://my.gov.au';
  
  scraper.run(startUrl)
    .then(async () => { await scraper.indexPages(); console.log('Scraping complete!'); })
    .catch(console.error);
}

module.exports = MyGovScraper;

// Helpers
function baseUrl(url) {
  try { const u = new URL(url); u.hash = ''; u.search = ''; return u.toString(); } catch { return (url||'').split('#')[0]; }
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHashedEmbedding(text, dim = 256) {
  const vec = new Array(dim).fill(0);
  const toks = normalizeText(text).split(' ').filter(Boolean);
  for (const t of toks) {
    // simple string hash
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const idx = h % dim;
    vec[idx] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map(v => v / norm);
}
