#!/usr/bin/env node

/**
 * FragmentEngine Eval Runner
 *
 * Runs evaluations in 3 modes:
 * 1. Baseline (no tools)
 * 2. With tools (single-shot)
 * 3. Adversarial (with reviewer forcing retries)
 *
 * Usage:
 *   node run-eval.js <eval-name> [--mode baseline|tools|adversarial]
 *
 * Example:
 *   node run-eval.js government-services-grounding --mode adversarial
 */

const fs = require('fs').promises;
const path = require('path');
const { runAdversarialLoop, runSingleEval } = require('./adversarial-orchestrator');

// Parse command line args
const args = process.argv.slice(2);
const evalName = args[0] || 'government-services-grounding';
const mode = args.find(a => a.startsWith('--mode'))?.split('=')[1] || 'all';

// Load samples from JSONL
async function loadSamples(evalName) {
  const samplesPath = path.join(
    __dirname,
    'registry/data',
    evalName,
    'samples.jsonl'
  );

  const content = await fs.readFile(samplesPath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function factMatches(outputText, factEntry) {
  if (!outputText || !factEntry) return false;

  const normalizedOutput = normalizeText(outputText);
  const candidates = [];

  if (typeof factEntry === 'string') {
    candidates.push(factEntry);
  } else {
    if (factEntry.fact) candidates.push(factEntry.fact);
    if (Array.isArray(factEntry.match_phrases)) {
      candidates.push(...factEntry.match_phrases);
    }
    if (Array.isArray(factEntry.aliases)) {
      candidates.push(...factEntry.aliases);
    }

    if (factEntry.pattern) {
      try {
        const regex = new RegExp(factEntry.pattern, 'i');
        if (regex.test(outputText)) {
          return true;
        }
      } catch (error) {
        console.warn('Invalid fact pattern:', factEntry.pattern, error.message);
      }
    }
  }

  return candidates.some(candidate => {
    const normalizedCandidate = normalizeText(candidate);
    return normalizedCandidate && normalizedOutput.includes(normalizedCandidate);
  });
}

// Score a single result against ideal
function scoreResult(result, ideal, evalType, sample = {}) {
  const score = {
    correct: false,
    partial: false,
    details: {}
  };

  if (!result.responder_output) {
    return score;
  }

  const output = result.responder_output.toLowerCase();

  switch (evalType) {
    case 'factual_accuracy':
      // Check if ideal answer is in the response
      if (typeof ideal === 'string') {
        score.correct = output.includes(ideal.toLowerCase());
      }
      break;

    case 'completeness':
      // Check if all expected items are mentioned
      if (Array.isArray(ideal)) {
        const mentioned = ideal.filter(item =>
          output.includes(item.toLowerCase())
        );
        score.correct = mentioned.length === ideal.length;
        score.partial = mentioned.length > 0 && mentioned.length < ideal.length;
        score.details = {
          expected: ideal.length,
          found: mentioned.length,
          missing: ideal.filter(item => !output.includes(item.toLowerCase()))
        };
      }
      break;

    case 'entity_verification':
      if (ideal === 'no_such_entity') {
        // Should NOT hallucinate the entity or should say it doesn't exist
        score.correct = output.includes("doesn't exist") ||
                        output.includes("not found") ||
                        output.includes("no such") ||
                        !output.includes("payment") ||
                        !output.includes("subsidy");
      } else if (ideal === 'entity_disambiguation') {
        // Should recognize ambiguity
        score.correct = output.includes("family tax benefit") ||
                        output.includes("which") ||
                        output.includes("might mean");
      }
      break;

    case 'ai_summary': {
      const expectedFacts = sample.expected_facts || [];
      const disallowedFacts = sample.disallowed_facts || [];
      const missingExpected = expectedFacts.filter(fact => !factMatches(result.responder_output, fact));
      const disallowedHits = disallowedFacts.filter(fact => factMatches(result.responder_output, fact));
      const totalExpected = expectedFacts.length;
      const coverage = totalExpected > 0
        ? (totalExpected - missingExpected.length) / totalExpected
        : 1;

      score.correct = missingExpected.length === 0 && disallowedHits.length === 0;
      score.partial = !score.correct && missingExpected.length < totalExpected && disallowedHits.length === 0;
      score.details = {
        expected_total: totalExpected,
        coverage: Number(coverage.toFixed(2)),
        missing_expected: missingExpected.map(fact => fact.id || fact.fact || fact),
        disallowed_hits: disallowedHits.map(fact => fact.id || fact.fact || fact)
      };
      break;
    }
  }

  return score;
}

// Evaluate in a specific mode
async function runMode(samples, mode) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running eval in ${mode.toUpperCase()} mode`);
  console.log('='.repeat(60));

  const results = [];
  let correct = 0;
  let partial = 0;
  let total = samples.length;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const userQuery = sample.input[sample.input.length - 1].content;

    console.log(`\n[${i + 1}/${total}] ${userQuery.substring(0, 60)}...`);

    let result;

    try {
      switch (mode) {
        case 'baseline':
          result = await runSingleEval(sample, false);
          break;

        case 'tools':
          result = await runSingleEval(sample, true);
          break;

        case 'adversarial':
          result = await runAdversarialLoop(sample, 3);
          // Extract final response
          if (result.iterations.length > 0) {
            const lastIteration = result.iterations[result.iterations.length - 1];
            result.responder_output = lastIteration.responder_output;
            result.reviewer_verdict = lastIteration.reviewer_verdict;
          }
          break;
      }

      // Score the result
      const idealAnswer = sample.ideal ?? sample.ideal_summary ?? null;
      const score = scoreResult(result, idealAnswer, sample.eval_type, sample);

      result.sample_id = i;
      result.user_query = userQuery;
      result.ideal = sample.ideal;
      result.eval_type = sample.eval_type;
      result.score = score;

      if (score.correct) {
        correct++;
        console.log('  ✓ Correct');
      } else if (score.partial) {
        partial++;
        console.log('  ~ Partial');
        if (score.details.missing) {
          console.log(`    Missing: ${score.details.missing.join(', ')}`);
        }
      } else {
        console.log('  ✗ Incorrect');
      }

      // Show reviewer verdict if available
      if (result.reviewer_verdict) {
        console.log(`  Reviewer: ${result.reviewer_verdict.verdict} (confidence: ${result.reviewer_verdict.overall_confidence || 'N/A'})`);
      }

      results.push(result);

    } catch (error) {
      console.error(`  Error: ${error.message}`);
      results.push({
        sample_id: i,
        user_query: userQuery,
        error: error.message,
        score: { correct: false, partial: false }
      });
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Calculate metrics
  const accuracy = (correct / total) * 100;
  const partialRate = (partial / total) * 100;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${mode.toUpperCase()} Results`);
  console.log('='.repeat(60));
  console.log(`Total samples: ${total}`);
  console.log(`Correct: ${correct} (${accuracy.toFixed(1)}%)`);
  console.log(`Partial: ${partial} (${partialRate.toFixed(1)}%)`);
  console.log(`Incorrect: ${total - correct - partial}`);

  if (mode === 'adversarial') {
    const iterations = results
      .filter(r => r.iterations)
      .map(r => r.iterations.length);
    const avgIterations = iterations.length > 0
      ? (iterations.reduce((a, b) => a + b, 0) / iterations.length).toFixed(2)
      : 'N/A';
    const converged = results.filter(r => r.converged).length;

    console.log(`Average iterations: ${avgIterations}`);
    console.log(`Converged: ${converged}/${total} (${(converged / total * 100).toFixed(1)}%)`);
  }

  return {
    mode,
    results,
    metrics: {
      total,
      correct,
      partial,
      incorrect: total - correct - partial,
      accuracy,
      partialRate
    }
  };
}

// Main eval runner
async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   FragmentEngine Evaluation Runner        ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\nEval: ${evalName}`);
  console.log(`Mode: ${mode}\n`);

  try {
    // Load samples
    const samples = await loadSamples(evalName);
    console.log(`Loaded ${samples.length} samples`);

    // Run evaluations
    const allResults = {};

    if (mode === 'all') {
      // Run all modes for comparison
      allResults.baseline = await runMode(samples, 'baseline');
      allResults.tools = await runMode(samples, 'tools');
      allResults.adversarial = await runMode(samples, 'adversarial');

      // Comparison
      console.log(`\n${'='.repeat(60)}`);
      console.log('COMPARISON');
      console.log('='.repeat(60));
      console.log('Mode              | Accuracy | Partial | Incorrect');
      console.log('-'.repeat(60));
      console.log(`Baseline (no tools) | ${allResults.baseline.metrics.accuracy.toFixed(1)}%    | ${allResults.baseline.metrics.partialRate.toFixed(1)}%   | ${allResults.baseline.metrics.incorrect}`);
      console.log(`With Tools          | ${allResults.tools.metrics.accuracy.toFixed(1)}%    | ${allResults.tools.metrics.partialRate.toFixed(1)}%   | ${allResults.tools.metrics.incorrect}`);
      console.log(`Adversarial         | ${allResults.adversarial.metrics.accuracy.toFixed(1)}%    | ${allResults.adversarial.metrics.partialRate.toFixed(1)}%   | ${allResults.adversarial.metrics.incorrect}`);

      const improvement = allResults.adversarial.metrics.accuracy - allResults.baseline.metrics.accuracy;
      console.log(`\nImprovement: +${improvement.toFixed(1)} percentage points`);

    } else {
      // Run single mode
      allResults[mode] = await runMode(samples, mode);
    }

    // Save results
    const outputDir = path.join(__dirname, 'results');
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      outputDir,
      `${evalName}-${mode}-${timestamp}.json`
    );

    await fs.writeFile(
      outputPath,
      JSON.stringify(allResults, null, 2),
      'utf-8'
    );

    console.log(`\n✓ Results saved to: ${outputPath}`);

  } catch (error) {
    console.error('\n❌ Eval failed:', error);
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, loadSamples, scoreResult, factMatches };
