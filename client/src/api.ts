export type Impact = "critical" | "serious" | "moderate" | "minor";

export interface WcagRef {
  criterion: string;
  name: string;
  level: string;
}

export interface AuditNode {
  html: string;
  target: string;
}

export interface Violation {
  id: string;
  impact: Impact;
  description: string;
  helpUrl: string;
  wcagTags: string[];
  wcag: WcagRef;
  userImpact: string;
  nodes: AuditNode[];
}

export interface AuditResponse {
  url: string;
  finalUrl: string;
  pageTitle: string;
  summary: Record<Impact, number>;
  totalViolations: number;
  totalElements: number;
  violations: Violation[];
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

export interface FixValidation {
  passes: boolean;
  remainingViolations: string[];
}

async function parseError(res: Response): Promise<Error> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return new Error(body.error);
    }
  } catch {
    // fall through to generic message
  }
  return new Error(`Request failed with status ${res.status}`);
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function runAudit(url: string): Promise<AuditResponse> {
  return postJson("/api/audit", { url });
}

export function getRemediation(violation: Violation, pageUrl: string): Promise<Remediation> {
  return postJson("/api/remediate", {
    violation: {
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      wcagTags: violation.wcagTags,
      html: violation.nodes[0]?.html ?? "",
    },
    url: pageUrl,
  });
}

export function validateFix(htmlSnippet: string, ruleId: string): Promise<FixValidation> {
  return postJson("/api/validate-fix", { htmlSnippet, ruleId });
}
