import { newContext } from "./browser.js";
import { AXE_SOURCE } from "./axe.js";
import { getKnowledge, type WcagRef } from "./knowledge.js";

export interface AuditNode {
  html: string;
  target: string;
}

export interface AuditViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  helpUrl: string;
  wcagTags: string[];
  // Curated mapping from the local knowledge base — available without any
  // LLM call, so the UI can show WCAG context immediately.
  wcag: WcagRef;
  userImpact: string;
  nodes: AuditNode[];
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  pageTitle: string;
  summary: Record<string, number>;
  totalViolations: number;
  totalElements: number;
  violations: AuditViolation[];
}

// Raw shapes straight out of axe.run() — we only keep what we need.
interface AxeRawNode {
  html: string;
  target: (string | string[])[];
}
interface AxeRawViolation {
  id: string;
  impact?: string | null;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeRawNode[];
}
interface AxeRawResult {
  violations: AxeRawViolation[];
}

const MAX_HTML_LEN = 300;
const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;

function normalizeImpact(impact?: string | null): AuditViolation["impact"] {
  return (IMPACTS as readonly string[]).includes(impact ?? "")
    ? (impact as AuditViolation["impact"])
    : "minor";
}

function truncateHtml(html: string): string {
  const oneLine = html.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_HTML_LEN ? oneLine.slice(0, MAX_HTML_LEN) + "…" : oneLine;
}

function normalizeTarget(target: (string | string[])[]): string {
  // axe targets look like [["#main"], [".btn", ":nth-child(2)"]] — flatten for display.
  return target.map((t) => (Array.isArray(t) ? t.join(" ") : String(t))).join(", ");
}

export async function runAudit(url: string): Promise<AuditResult> {
  const context = await newContext({
    // Look like a normal desktop browser so fewer sites block us outright.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    if (!response) throw new Error("The page didn't respond.");
    if (response.status() >= 400) {
      throw new Error(`The site returned HTTP ${response.status()}.`);
    }
    // Let client-rendered apps settle before auditing.
    await page.waitForTimeout(1500);

    // Inject axe-core into the page, then run only the violation checks —
    // "incomplete"/"passes" would bloat the payload for no demo value.
    // (addScriptTag is inline, so a strict CSP can refuse it — handled below.)
    try {
      await page.addScriptTag({ content: AXE_SOURCE });
    } catch {
      throw new Error("The site's security policy blocked the audit script from running.");
    }
    // Evaluated as a string so we don't need DOM lib types in tsconfig.
    const raw = (await page.evaluate(
      `window.axe.run(document, { resultTypes: ["violations"] })`
    )) as unknown as AxeRawResult;

    const violations: AuditViolation[] = (raw.violations ?? []).map((v) => {
      const knowledge = getKnowledge(v.id);
      return {
        id: v.id,
        impact: normalizeImpact(v.impact),
        description: v.description,
        helpUrl: v.helpUrl,
        wcagTags: (v.tags ?? []).filter((t) => t.startsWith("wcag")),
        wcag: knowledge.wcag,
        userImpact: knowledge.userImpact,
        nodes: (v.nodes ?? []).slice(0, 25).map((n) => ({
          html: truncateHtml(n.html ?? ""),
          target: normalizeTarget(n.target ?? []),
        })),
      };
    });

    const summary: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    let totalElements = 0;
    for (const v of violations) {
      summary[v.impact] += 1;
      totalElements += v.nodes.length;
    }

    return {
      url,
      finalUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
      summary,
      totalViolations: violations.length,
      totalElements,
      violations,
    };
  } finally {
    // Always clean up the context — leaked pages eat memory fast.
    await context.close().catch(() => {});
  }
}
