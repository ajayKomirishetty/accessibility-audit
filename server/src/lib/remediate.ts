import Anthropic from "@anthropic-ai/sdk";
import { getKnowledge, type KnowledgeEntry, type WcagRef } from "./knowledge.js";

export interface ViolationInput {
  id: string;
  impact: string;
  description: string;
  wcagTags: string[];
  html: string; // one offending snippet, already truncated
}

export interface Remediation {
  explanation: string;
  userImpact: string;
  wcag: WcagRef;
  fixBefore: string;
  fixAfter: string;
  howToVerify: string[];
  confidence: "high" | "medium" | "low";
  mocked: boolean;
}

const SYSTEM_PROMPT = `You are an accessibility expert helping a developer fix a WCAG violation found by an automated audit (axe-core).

You are given a curated knowledge entry for the violated rule. Ground your answer in it — do not contradict its WCAG mapping or fix pattern.

Respond with ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
{
  "explanation": "2-3 plain-language sentences on what is wrong and why the rule exists.",
  "userImpact": "2-3 sentences on who is affected (screen reader users, keyboard-only users, people with low vision, etc.) and what their experience is like when this is broken.",
  "wcag": { "criterion": "e.g. 1.1.1", "name": "e.g. Non-text Content", "level": "A | AA | AAA" },
  "fixBefore": "the offending code pattern (short snippet)",
  "fixAfter": "the fixed code (short snippet)",
  "howToVerify": ["3-4 concrete verification steps"],
  "confidence": "high | medium | low — your confidence that the suggested fix fully resolves the violation"
}

Rules:
- Keep snippets minimal and realistic. Do not invent unrelated context.
- The fix must be a real fix, not just adding aria-label to a div that should be a native element. Prefer native HTML semantics.
- Set confidence to "low" when the right fix depends on context you can't see, and say so in the explanation.
- Be honest about limits: if the check can't fully verify the fix automatically, include manual or assistive-technology testing in howToVerify.`;

/**
 * Schema check on the model's JSON. Returns a list of problems (empty = valid).
 * The agent gets exactly one repair retry with these problems spelled out.
 */
function validateRemediationShape(parsed: unknown): string[] {
  const problems: string[] = [];
  if (!parsed || typeof parsed !== "object") return ["response is not a JSON object"];
  const p = parsed as Record<string, unknown>;
  const needString = (key: string) => {
    if (typeof p[key] !== "string" || !(p[key] as string).trim()) problems.push(`"${key}" must be a non-empty string`);
  };
  needString("explanation");
  needString("userImpact");
  needString("fixBefore");
  needString("fixAfter");
  if (!p.wcag || typeof p.wcag !== "object") {
    problems.push('"wcag" must be an object');
  } else {
    const w = p.wcag as Record<string, unknown>;
    for (const k of ["criterion", "name", "level"]) {
      if (typeof w[k] !== "string" || !(w[k] as string).trim()) problems.push(`"wcag.${k}" must be a non-empty string`);
    }
  }
  if (!Array.isArray(p.howToVerify) || p.howToVerify.length === 0 || !p.howToVerify.every((s) => typeof s === "string")) {
    problems.push('"howToVerify" must be a non-empty array of strings');
  }
  if (!["high", "medium", "low"].includes(p.confidence as string)) {
    problems.push('"confidence" must be one of "high", "medium" or "low"');
  }
  return problems;
}

function shapeRemediation(parsed: Record<string, unknown>, mocked: boolean): Remediation {
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v : fallback;
  const w = parsed.wcag as Record<string, unknown>;
  return {
    explanation: str(parsed.explanation, ""),
    userImpact: str(parsed.userImpact, ""),
    wcag: {
      criterion: str(w.criterion, "—"),
      name: str(w.name, "—"),
      level: str(w.level, "—"),
    },
    fixBefore: str(parsed.fixBefore, ""),
    fixAfter: str(parsed.fixAfter, ""),
    howToVerify: (parsed.howToVerify as string[]).filter((s) => s.trim()).slice(0, 6),
    confidence: parsed.confidence as Remediation["confidence"],
    mocked,
  };
}

function buildUserPrompt(v: ViolationInput, entry: KnowledgeEntry, pageUrl?: string): string {
  return [
    `axe-core rule: ${v.id} (impact: ${v.impact})`,
    `What the checker found: ${v.description}`,
    v.wcagTags.length ? `WCAG tags from the checker: ${v.wcagTags.join(", ")}` : "",
    v.html ? `Offending markup:\n${v.html}` : "",
    pageUrl ? `Page: ${pageUrl}` : "",
    "",
    "--- Curated knowledge entry for this rule ---",
    `Title: ${entry.title}`,
    `User impact: ${entry.userImpact}`,
    `WCAG: ${entry.wcag.criterion} ${entry.wcag.name} (Level ${entry.wcag.level})`,
    `Canonical fix pattern:\nbefore:\n${entry.fix.before}\nafter:\n${entry.fix.after}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Defensive JSON extraction: find the outermost object and parse that. */
function parseJsonSafely(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(text.slice(start, end + 1));
}

/** Template fallback built from the knowledge entry — used when the model
 *  output fails validation twice. Never exposes raw model output. */
function templateFallback(v: ViolationInput, entry: KnowledgeEntry): Remediation {
  return {
    explanation: `${entry.title}. ${entry.explanation}`,
    userImpact: entry.userImpact,
    wcag: entry.wcag,
    fixBefore: v.html || entry.fix.before,
    fixAfter: entry.fix.after,
    howToVerify: entry.verify,
    confidence: "medium",
    mocked: false,
  };
}

async function callLlm(v: ViolationInput, entry: KnowledgeEntry, pageUrl?: string): Promise<Remediation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Set MOCK_MODE=true for the demo, or add a key.");
  }
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
  const basePrompt = buildUserPrompt(v, entry, pageUrl);

  const attempt = async (extraInstructions?: string): Promise<Remediation> => {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: extraInstructions ? `${basePrompt}\n\n${extraInstructions}` : basePrompt,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) throw new Error("empty model response");
    const parsed = parseJsonSafely(text);
    const problems = validateRemediationShape(parsed);
    if (problems.length > 0) {
      const err = new Error("schema validation failed") as Error & { problems: string[] };
      err.problems = problems;
      throw err;
    }
    return shapeRemediation(parsed as Record<string, unknown>, false);
  };

  try {
    return await attempt();
  } catch (err) {
    // One repair retry: show the model exactly what was wrong with its output.
    const problems = (err as Error & { problems?: string[] }).problems;
    if (!problems) throw err;
    try {
      return await attempt(
        `Your previous response was invalid JSON for the required schema. Fix these problems and respond with ONLY the corrected JSON object:\n- ${problems.join("\n- ")}`
      );
    } catch {
      return templateFallback(v, entry);
    }
  }
}

/** Mock mode (default): realistic canned responses built from the knowledge
 *  base — same JSON shape as the LLM path, no API key, no network. */
function mockRemediation(v: ViolationInput, entry: KnowledgeEntry): Remediation {
  return {
    explanation: `${entry.title}. ${entry.explanation}`,
    userImpact: entry.userImpact,
    wcag: entry.wcag,
    fixBefore: v.html || entry.fix.before,
    fixAfter: entry.fix.after,
    howToVerify: entry.verify,
    confidence: "high",
    mocked: true,
  };
}

/**
 * The remediation "agent" pipeline:
 *   retrieve (knowledge lookup by rule id) → prompt → LLM → validate →
 *   one repair retry → template fallback.
 */
export async function getRemediation(v: ViolationInput, pageUrl?: string): Promise<Remediation> {
  const entry = getKnowledge(v.id);
  const mockMode = (process.env.MOCK_MODE ?? "true").toLowerCase() !== "false";
  if (mockMode) return mockRemediation(v, entry);
  return callLlm(v, entry, pageUrl);
}
