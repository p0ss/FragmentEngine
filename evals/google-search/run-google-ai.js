#!/usr/bin/env node

/**
 * Google AI Summary Evaluator
 *
 * Loads captured Google Search AI summaries for predefined search terms
 * and scores them against expected vs. disallowed facts derived from
 * FragmentEngine fragments.
 */

const fs = require('fs').promises;
const path = require('path');
const pathToRoot = path.resolve(__dirname, '..');
const { loadSamples, scoreResult } = require('../run-eval');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    evalName: 'google-search-ai',
    captureDir: path.join(__dirname, 'captures'),
    outputDir: path.join(__dirname, 'results')
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--eval') {
      opts.evalName = args[++i] || opts.evalName;
    } else if (arg === '--capture-dir') {
      opts.captureDir = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--output-dir') {
      opts.outputDir = path.resolve(process.cwd(), args[++i]);
    }
  }

  return opts;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'capture';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function loadCapturedSummary(sample, captureDir) {
  if (sample.captured_summary) {
    return sample.captured_summary.trim();
  }

  const candidateFiles = [];

  if (sample.captured_summary_file) {
    const relPath = sample.captured_summary_file;
    candidateFiles.push(path.resolve(pathToRoot, relPath));
    candidateFiles.push(path.resolve(__dirname, relPath));
  }

  if (captureDir) {
    const slug = sample.capture_slug || slugify(sample.search_term);
    candidateFiles.push(path.join(captureDir, `${slug}.txt`));
    candidateFiles.push(path.join(captureDir, `${slug}.md`));
  }

  for (const file of candidateFiles) {
    if (!file) continue;
    if (await fileExists(file)) {
      const content = await fs.readFile(file, 'utf-8');
      const cleaned = content.trim();
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }

  return null;
}

async function evaluateSummaries(opts) {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Google Search AI Summary Evaluation     ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`Eval: ${opts.evalName}`);
  console.log(`Captures: ${opts.captureDir}`);
  console.log('');

  const samples = await loadSamples(opts.evalName);
  const results = [];
  let correct = 0;
  let partial = 0;
  let missingCaptures = 0;
  const coverageValues = [];
  let disallowedHits = 0;

  for (const sample of samples) {
    const summary = await loadCapturedSummary(sample, opts.captureDir);
    const label = sample.search_term || sample.capture_slug || 'search';

    if (!summary) {
      console.warn(`⚠️  Missing capture for "${label}"`);
      missingCaptures++;
      results.push({
        search_term: sample.search_term,
        error: 'capture_not_found'
      });
      continue;
    }

    const mockedResult = { responder_output: summary };
    const evalType = sample.eval_type || 'ai_summary';
    const idealAnswer = sample.ideal || sample.ideal_summary || null;
    const score = scoreResult(mockedResult, idealAnswer, evalType, sample);

    if (score.correct) correct++;
    else if (score.partial) partial++;

    if (typeof score?.details?.coverage === 'number') {
      coverageValues.push(score.details.coverage);
    }
    const disallowed = score?.details?.disallowed_hits?.length || 0;
    disallowedHits += disallowed;

    results.push({
      search_term: sample.search_term,
      capture_slug: sample.capture_slug || slugify(sample.search_term),
      summary,
      score
    });

    console.log(`• ${label}`);
    console.log(`  Coverage: ${(score.details?.coverage ?? 0).toString()}`);
    if (score.details?.missing_expected?.length) {
      console.log(`  Missing facts: ${score.details.missing_expected.join(', ')}`);
    }
    if (disallowed) {
      console.log(`  ❌ Disallowed facts hit: ${score.details.disallowed_hits.join(', ')}`);
    }
    console.log(`  Verdict: ${score.correct ? 'ACCURATE' : score.partial ? 'PARTIAL' : 'FAILED'}`);
  }

  const evaluated = samples.length - missingCaptures;
  const accuracy = evaluated ? (correct / evaluated) * 100 : 0;
  const partialRate = evaluated ? (partial / evaluated) * 100 : 0;
  const averageCoverage = coverageValues.length
    ? coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length
    : 0;

  console.log('\n=== Summary ===');
  console.log(`Samples: ${samples.length} (evaluated: ${evaluated}, missing captures: ${missingCaptures})`);
  console.log(`Accurate: ${correct} (${accuracy.toFixed(1)}%)`);
  console.log(`Partial: ${partial} (${partialRate.toFixed(1)}%)`);
  console.log(`Hallucination hits: ${disallowedHits}`);
  console.log(`Avg fact coverage: ${averageCoverage.toFixed(2)}`);

  await fs.mkdir(opts.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(
    opts.outputDir,
    `${opts.evalName}-google-ai-${timestamp}.json`
  );

  await fs.writeFile(
    outputPath,
    JSON.stringify({
      eval: opts.evalName,
      capture_dir: opts.captureDir,
      metrics: {
        total_samples: samples.length,
        evaluated,
        correct,
        partial,
        accuracy,
        partial_rate: partialRate,
        hallucination_hits: disallowedHits,
        average_coverage: Number(averageCoverage.toFixed(2))
      },
      results
    }, null, 2)
  );

  console.log(`\nResults saved to ${outputPath}`);
}

if (require.main === module) {
  evaluateSummaries(parseArgs()).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { evaluateSummaries };
