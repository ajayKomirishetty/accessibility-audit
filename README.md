# A11y Remediation Copilot

A small proof of concept: paste any public URL, get a real automated accessibility audit (axe-core running in headless Chromium), then get an AI-drafted plain-language explanation and code fix for each violation — and a re-run of the automated check to confirm the fix actually works.

I built this as a showcase for Fable's Senior Software Engineer role — it touches the three things the role asks for: scalable backend services and APIs, full-stack development, and AI engineering (LLM integration with structured outputs, a small agent pipeline, and a validation loop). And it's in Fable's domain: digital accessibility.

**An honest note up front:** automated checks only catch a fraction of real accessibility barriers — missing alt text, contrast, landmarks. They can't tell you whether a page actually *works* for someone using a screen reader. Fable's real value is testing with people with disabilities, and nothing here replaces that. This tool is a starting point, not a verdict.

## How it works

```
┌────────────┐     ┌────────────────┐     ┌─────────────────────┐
│  React +   │────▶│  Node/TS API   │────▶│ Headless Chromium   │
│  Vite      │◀────│  (Fastify)     │◀────│  + axe-core inject  │
└────────────┘     └───────┬────────┘     └─────────────────────┘
                           │
              ┌────────────┴────────────┐
              │ Remediation agent:      │
              │  retrieve (local WCAG   │
              │  knowledge base) →      │
              │  LLM (strict JSON) →    │
              │  schema-validate →      │
              │  repair retry →         │
              │  template fallback      │
              └────────────┬────────────┘
                           │ fix proposed
                           ▼
              ┌────────────────────────┐
              │ Fix validation: re-run │
              │ axe on the "after"     │
              │ snippet, scoped to the │
              │ rule → ✓ / ⚠ badge     │
              └────────────────────────┘
```

1. **Audit** — `POST /api/audit` validates the URL (http/https only, blocks localhost and private IPs to prevent SSRF), loads the page in headless Chromium, injects axe-core, and returns normalized violations: rule id, impact, WCAG tags, help text, affected HTML snippets, and target selectors — plus a summary count by impact. Each violation also carries a curated WCAG mapping and "why it matters" text from the local knowledge base, so the UI shows that context with no LLM call.
2. **Remediate (agent pipeline)** — `POST /api/remediate` runs a small pipeline in `server/src/lib/remediate.ts`:
   - *Retrieve*: look up the axe rule id in `server/src/lib/wcag-knowledge.json` (20 common rules with user impact, WCAG criterion, and a canonical fix pattern). This stands in for RAG — production would use vector retrieval over the WCAG spec and internal docs.
   - *Generate*: call the LLM with the knowledge entry in the prompt, demanding strict JSON.
   - *Validate*: schema-check the response in code. On failure, one repair retry that includes the validation errors.
   - *Fallback*: if the output is still invalid, build a template response from the knowledge entry. Raw model errors never reach the client.
3. **Validate the fix** — `POST /api/validate-fix` renders the proposed "after" snippet in a blank page in headless Chromium and re-runs axe scoped to that rule. The UI shows "✓ Fix validated" or "⚠ Fix needs review" — turning "the LLM thinks it's fixed" into "an automated check confirmed it."

## The demo UI is itself accessible

Seemed wrong to demo an accessibility tool with an inaccessible UI, so: semantic HTML throughout (`header`/`main`/`footer`, real `<button>`s, labeled form controls), visible `:focus-visible` styles, full keyboard operability (expandable violations are buttons, Escape closes an open panel, focus moves to generated results), `aria-live="polite"` announcements for audit progress and results ("Audit complete: 7 violations found"), `role="alert"` on errors, and a `prefers-reduced-motion` query that disables animations. The markup was written against axe-core's rules (landmarks, labeled controls, focus visibility, live regions) as I built it.

## Run it

You'll need Node 18+. Two terminals:

```bash
# terminal 1 — backend
cd server
npm install
npx playwright install --only-shell chromium   # one-time browser download
cp .env.example .env                           # optional; works with defaults
npm run dev                                    # http://localhost:3001

# terminal 2 — frontend
cd client
npm install
npm run dev                                    # http://localhost:5173
```

Open http://localhost:5173, paste a URL (try `https://example.com`), hit **Run audit**.

## Environment variables (server)

| Var | Default | What it does |
|---|---|---|
| `PORT` | `3001` | API port |
| `MOCK_MODE` | `true` | `true` = canned remediation responses, no API key needed. Set to `false` to call the real Anthropic API. |
| `ANTHROPIC_API_KEY` | — | Only needed when `MOCK_MODE=false` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Model used when `MOCK_MODE=false` |

## API

**POST /api/audit**

```json
{ "url": "https://example.com" }
```

Returns (one violation shown):

```json
{
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "pageTitle": "Example Domain",
  "summary": { "critical": 0, "serious": 1, "moderate": 0, "minor": 2 },
  "totalViolations": 3,
  "totalElements": 5,
  "violations": [
    {
      "id": "region",
      "impact": "moderate",
      "description": "Ensures all page content is contained by landmarks",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/region",
      "wcagTags": ["wcag2a", "wcag131"],
      "wcag": { "criterion": "1.3.1", "name": "Info and Relationships", "level": "A" },
      "userImpact": "Content outside landmarks is invisible to landmark navigation…",
      "nodes": [{ "html": "<div>…</div>", "target": "body > div" }]
    }
  ]
}
```

Errors: `400` bad URL / unresolvable host / private IP, `504` page load timed out (~25s), `502` site blocked the headless browser, `500` anything else. The body is always `{ "error": "human-readable message" }`.

**POST /api/remediate**

```json
{
  "violation": {
    "id": "image-alt",
    "impact": "critical",
    "description": "Ensures <img> elements have alternate text",
    "wcagTags": ["wcag2a", "wcag111"],
    "html": "<img src=\"/chart.png\">"
  },
  "url": "https://example.com/"
}
```

Returns strict JSON:

```json
{
  "explanation": "…",
  "userImpact": "…",
  "wcag": { "criterion": "1.1.1", "name": "Non-text Content", "level": "A" },
  "fixBefore": "<img src=\"/chart.png\">",
  "fixAfter": "<img src=\"/chart.png\" alt=\"…\">",
  "howToVerify": ["…", "…"],
  "confidence": "high",
  "mocked": true
}
```

`mocked: true` means the response came from the canned demo set. `confidence` is the model's own assessment (or `"medium"` for template fallbacks).

**POST /api/validate-fix**

```json
{ "htmlSnippet": "<button aria-label=\"Close\">×</button>", "ruleId": "button-name" }
```

Returns `{ "passes": true, "remainingViolations": [] }`. The snippet is wrapped in a minimal page and checked with axe scoped to the single rule. `400` for missing/oversized input or unknown rule id.

**GET /api/health** — `{ "ok": true, "mockMode": true }`.

## Limitations

- **Automated checks ≠ accessibility.** Keyboard traps, focus order, meaningful alt text, and whether a flow actually makes sense can only be judged by people — ideally people with disabilities. This tool finds the easy, mechanical stuff.
- **Some sites block headless browsers** (bot detection, strict CSP). The audit fails gracefully in those cases instead of pretending. Same for networks where Chromium itself can't reach the public internet (strict egress proxies) — you get a clear `502`, not a hang.
- **Mock mode is canned, not intelligent.** The demo responses come from the knowledge base; anything the LLM path returns unverified gets a template fallback instead. Flip `MOCK_MODE=false` with a real key for actual LLM output.
- **The validation loop checks one rule, not the page.** It confirms the snippet passes the specific axe rule — it doesn't prove the fix is correct in the page's real context.
- **No auth, no persistence, no rate limiting.** It's a weekend POC — one shared browser, in-memory everything.

## What I'd build next

- **Full agentic loop** — apply the suggested fix in a sandboxed copy of the real page, re-run the whole audit, and only show fixes that reduce the violation count. The current validation loop is the seed of this.
- **Real RAG over WCAG docs** — replace the JSON lookup with vector retrieval over the WCAG spec, axe rule docs, and Fable's internal guidance, with citations in every answer.
- **Eval harness for the AI output** — a golden set of violations with expected fixes, run on every prompt change, so quality doesn't regress silently.
- **Saved reports + auth** — let teams save audits, track violations over time, and see whether they're actually improving.
- **CI integration** — a GitHub Action that audits preview deployments on every PR and comments the new violations, so issues get caught before they ship.
