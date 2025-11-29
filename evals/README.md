# FragmentEngine Adversarial Evals

Adversarial evaluation framework inspired by OpenAI Evals, adapted for testing LLM accuracy with MCP tool access and self-correction via reviewer feedback.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Eval Sample (from registry/data/*.jsonl)           │
│  - User query                                        │
│  - Expected answer (ideal)                           │
│  - Facets context                                    │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│  RESPONDER (Claude)                                  │
│  - Generates response                                │
│  - Has access to MCP tools (optional)                │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│  REVIEWER (Claude)                                   │
│  - Extracts factual claims                           │
│  - Uses MCP tools to verify each claim               │
│  - Returns: ACCEPT | REJECT | NEEDS_REVISION         │
└──────────────────────────────────────────────────────┘
                        ↓
         If REJECT → Responder retries with feedback
         If ACCEPT → Move to next sample
         (Max 3 iterations)
```

## Quick Start

### 1. Ensure Services Running

```bash
docker-compose up -d typesense mcp-server api
```

### 2. Run Evaluations

```bash
cd evals

# Run single mode
npm run eval:baseline      # No tools
npm run eval:tools         # With tools, no reviewer
npm run eval:adversarial   # With adversarial reviewer

# Run all modes for comparison
npm run eval:all
```

### 3. View Results

Results are saved to `evals/results/` with timestamp:

```bash
cat results/government-services-grounding-all-2025-*.json
```

## Evaluation Modes

### Baseline (No Tools)
- LLM responds from training data only
- No access to MCP tools
- Shows baseline accuracy

### With Tools (Single-Shot)
- LLM has access to 6 MCP tools
- No adversarial review
- Tests if model uses tools proactively

### Adversarial (With Reviewer)
- Responder uses tools
- Reviewer checks every claim
- Forces retry if inaccurate
- Tests convergence to accuracy

## Registry Structure

Following OpenAI evals patterns:

```
evals/
├── registry/
│   ├── data/
│   │   └── government-services-grounding/
│   │       └── samples.jsonl              # Test cases
│   └── evals/
│       └── government-services-grounding.yaml  # Eval config
├── prompts/
│   ├── reviewer.md                        # Reviewer system prompt
│   └── responder-retry.md                 # Retry prompt with feedback
├── adversarial-orchestrator.js            # Core loop logic
├── run-eval.js                            # Main eval runner
└── results/                               # Output directory
```

## Sample Format (JSONL)

```jsonl
{
  "input": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "How long is Paid Parental Leave?"}
  ],
  "ideal": "18 weeks",
  "facets": {"provider": "Services Australia", "life_event": "Having a baby"},
  "eval_type": "factual_accuracy"
}
```

### Eval Types

- `factual_accuracy`: Check specific facts (durations, amounts, requirements)
- `completeness`: Check if all relevant services mentioned
- `entity_verification`: Check entity existence/disambiguation

## Metrics

### Output Metrics
- **Accuracy**: % of samples with correct responses
- **Partial**: % with some correct elements
- **Incorrect**: % completely wrong

### Adversarial-Specific Metrics
- **Average iterations**: How many retries needed
- **Convergence rate**: % that reached ACCEPT within max iterations
- **First-attempt accuracy**: % accepted without retry

## Adding New Evals

### 1. Create Sample Data

```bash
# Create new eval directory
mkdir -p registry/data/my-eval

# Add samples
cat > registry/data/my-eval/samples.jsonl << 'EOF'
{"input": [...], "ideal": "...", "eval_type": "..."}
{"input": [...], "ideal": "...", "eval_type": "..."}
EOF
```

### 2. Register Eval

```yaml
# registry/evals/my-eval.yaml
my-eval:
  id: my-eval.dev.v0
  description: "Test for ..."
  metrics: [accuracy, completeness]

my-eval.dev.v0:
  class: FragmentEngineEval
  args:
    samples_jsonl: my-eval/samples.jsonl
    mcp_tools_enabled: true
```

### 3. Run

```bash
node run-eval.js my-eval --mode=all
```

## Customizing Prompts

Edit prompts in `prompts/`:

- **`reviewer.md`**: How reviewer extracts and verifies claims
- **`responder-retry.md`**: How responder corrects errors

Key sections to tune:
- Confidence thresholds (currently 0.6-0.7)
- Tool selection logic
- Error categorization
- Retry strategies

## Google Search AI Summary Eval

The `google-search-ai` registry mirrors the OpenAI evals format but scores captured Google Search AI Overview summaries against FragmentEngine facts.

1. **Bootstrap facts** (optional but recommended):
   ```bash
   cd evals
   npm run eval:google-ai:facts
   ```
   This hits your local Typesense instance, pulls the top fragments for each search term, and writes candidate fact snippets to `registry/data/google-search-ai/generated/<slug>.json`.

2. **Capture Google AI outputs**: run the search term in Google, copy the AI Overview text, and paste it into `evals/google-ai-captures/<capture_slug>.txt`. The slug defaults to the dashed search term but can be overridden per sample via `capture_slug`.

3. **Run the eval**:
   ```bash
   cd evals
   npm run eval:google-ai
   ```
   The runner (`run-google-ai.js`) loads the captured text, checks that every `expected_fact` is mentioned, and ensures no `disallowed_fact` appears. Metrics include coverage and hallucination hits, with JSON output under `evals/results/`.

4. **Automate captures (optional but recommended)**:
   ```bash
   cd evals
   # Single query
   npm run capture:google-ai -- --query "jobseeker payment" --screenshot

   # Batch mode from newline-delimited file
   npm run capture:google-ai -- --list queries.txt --headless
   ```
   `scripts/capture-google-ai.js` drives a real Chrome instance via Puppeteer, dismisses consent prompts, and saves both a `.txt` summary and a `.json` metadata file to `google-ai-captures/`. Set `CHROME_PATH=/path/to/Google\ Chrome` if you want to use your installed browser instead of Puppeteer’s bundled Chromium. Add `--screenshot` to archive a PNG for manual review. The capture script deliberately defaults to non-headless mode to reduce the chance of triggering Google’s bot wall; headless mode is available via `--headless` for CI.

### Sample format (`registry/data/google-search-ai/samples.jsonl`)

```jsonl
{
  "search_term": "paid parental leave australia",
  "capture_slug": "paid-parental-leave",
  "ideal_summary": "Paid Parental Leave gives eligible parents up to 18 weeks of Parental Leave Pay.",
  "expected_facts": [
    {"id": "ppl-duration", "fact": "Paid Parental Leave provides up to 18 weeks of Parental Leave Pay", "match_phrases": ["18 weeks"]}
  ],
  "disallowed_facts": [
    {"id": "ppl-12-months", "fact": "Paid Parental Leave requires 12 months of continuous employment"}
  ],
  "gold_references": [{"title": "Services Australia", "url": "https://www.servicesaustralia.gov.au/paid-parental-leave-scheme"}]
}
```

`expected_facts` and `disallowed_facts` accept either plain strings or structured objects with `match_phrases`/`aliases`/`pattern` to control matching. Each sample can also point to fragment IDs for traceability.

## Environment Variables

```bash
# Override API endpoints
export MCP_URL=http://localhost:8081
export LLM_API_URL=http://localhost:3000/api/llm

# Then run evals
npm run eval:all
```

## Troubleshooting

### "Cannot connect to MCP server"
```bash
docker-compose up -d mcp-server
# Wait 5 seconds
npm run eval:adversarial
```

### "LLM API error"
Check that API is running and LiteLLM/Ollama configured:
```bash
curl http://localhost:3000/api/llm/models
```

### "No samples loaded"
Check JSONL file format - each line must be valid JSON.

### Reviewer always rejects
Lower confidence threshold in `prompts/reviewer.md`:
```
- **REJECT** if any claim has confidence < 0.5  # was 0.6
```

## Expected Results

Based on our hypothesis:

| Mode | Expected Accuracy |
|------|-------------------|
| Baseline | 60-70% |
| With Tools | 75-85% |
| Adversarial | 90-95% |

The adversarial mode should show:
- Higher accuracy than single-shot
- More iterations for initially wrong responses
- Convergence to correct answers
- Better citation behavior (includes URLs)

## Integration with CI/CD

```yaml
# .github/workflows/eval.yml
name: Run Evals
on: [push]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: docker-compose up -d
      - run: cd evals && npm run eval:all
      - run: |
          # Parse results and fail if accuracy < threshold
          ACCURACY=$(jq '.adversarial.metrics.accuracy' results/*.json)
          if (( $(echo "$ACCURACY < 80" | bc -l) )); then
            echo "Accuracy $ACCURACY below threshold"
            exit 1
          fi
```

## Future Enhancements

### Phase 2: Advanced Metrics
- F1 score for completeness
- Citation accuracy (URLs correct?)
- Latency per mode
- Token usage analysis

### Phase 3: More Eval Types
- Multi-turn conversations
- Eligibility decision trees
- Temporal reasoning (outdated info)
- Cross-service comparisons

### Phase 4: Agent-Based Evals
- Multiple agents debating
- Consensus building
- Confidence calibration
- Uncertainty quantification

## Related Files

- `/tests/mcp-tools.test.js` - Unit tests for individual MCP tools
- `/mcp-server/index.js` - v2 MCP tool implementations
- `/IMPLEMENTATION_SUMMARY.md` - Overall architecture docs
