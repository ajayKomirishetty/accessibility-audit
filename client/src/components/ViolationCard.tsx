import { useEffect, useRef, useState } from "react";
import {
  getRemediation,
  validateFix,
  type FixValidation,
  type Remediation,
  type Violation,
} from "../api";

export const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"] as const;

export function ImpactBadge({ impact }: { impact: string }) {
  return <span className={`badge badge-${impact}`}>{impact}</span>;
}

export function WcagChips({ violation }: { violation: Violation }) {
  const { criterion, name, level } = violation.wcag;
  return (
    <p className="wcag-line">
      <span className="wcag-criterion">WCAG {criterion}</span>
      <span>{name}</span>
      {level !== "—" && <span className="wcag-level">Level {level}</span>}
    </p>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; fall back to a textarea hack
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button type="button" className="copy-btn" onClick={copy} aria-label={`Copy ${label}`}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  if (!code.trim()) return null;
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language}</span>
        <CopyButton text={code} label={`${language} snippet`} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

type ValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "passed" }
  | { status: "needs-review"; remaining: string[] }
  | { status: "error" };

function ValidationBadge({ state }: { state: ValidationState }) {
  if (state.status === "idle") return null;
  if (state.status === "validating") {
    return (
      <p className="validation-badge validating" role="status">
        <span className="spinner small" aria-hidden="true" />
        Re-running the axe check against the proposed fix…
      </p>
    );
  }
  if (state.status === "passed") {
    return (
      <p className="validation-badge passed" role="status">
        ✓ Fix validated — the axe re-check passes
      </p>
    );
  }
  if (state.status === "needs-review") {
    return (
      <p className="validation-badge needs-review" role="status">
        ⚠ Fix needs review — the re-check still flags: {state.remaining.join(", ")}
      </p>
    );
  }
  return (
    <p className="validation-badge validation-error" role="status">
      Couldn't run the validation check — verify the fix manually.
    </p>
  );
}

function RemediationPanel({ violation, pageUrl }: { violation: Violation; pageUrl: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [remediation, setRemediation] = useState<Remediation | null>(null);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const generate = async () => {
    setState("loading");
    setError("");
    setValidation({ status: "idle" });
    try {
      const result = await getRemediation(violation, pageUrl);
      setRemediation(result);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate a fix.");
      setState("error");
    }
  };

  // Move focus to the result heading so keyboard and screen reader users
  // land on the new content.
  useEffect(() => {
    if (state === "done") headingRef.current?.focus();
  }, [state]);

  // Once we have a fix, validate it: re-run axe on the proposed "after"
  // snippet. This is what turns a guess into a checked result.
  useEffect(() => {
    if (state !== "done" || !remediation || !remediation.fixAfter.trim()) return;
    let cancelled = false;
    setValidation({ status: "validating" });
    validateFix(remediation.fixAfter, violation.id)
      .then((result: FixValidation) => {
        if (cancelled) return;
        setValidation(
          result.passes
            ? { status: "passed" }
            : { status: "needs-review", remaining: result.remainingViolations }
        );
      })
      .catch(() => {
        if (!cancelled) setValidation({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [state, remediation, violation.id]);

  if (state === "idle") {
    return (
      <button type="button" className="btn btn-ai" onClick={generate}>
        ✨ Generate fix with AI
      </button>
    );
  }
  if (state === "loading") {
    return (
      <div className="ai-loading" role="status">
        <span className="spinner small" aria-hidden="true" />
        Drafting an explanation and fix…
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="ai-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-secondary" onClick={generate}>
          Try again
        </button>
      </div>
    );
  }
  if (!remediation) return null;

  return (
    <div className="remediation">
      <div className="remediation-header">
        <h4 ref={headingRef} tabIndex={-1}>
          Suggested fix
        </h4>
        <span
          className={`confidence confidence-${remediation.confidence}`}
          title="How confident the AI is that this fix fully resolves the violation"
        >
          confidence: {remediation.confidence}
        </span>
        {remediation.mocked && (
          <span className="mock-badge" title="Demo mode: canned response, no API call was made">
            demo data
          </span>
        )}
      </div>

      <p>{remediation.explanation}</p>

      <div className="before-after">
        <div>
          <h5>Before</h5>
          <CodeBlock code={remediation.fixBefore} language="html" />
        </div>
        <div>
          <h5>After</h5>
          <CodeBlock code={remediation.fixAfter} language="html" />
        </div>
      </div>

      <h5>How to verify</h5>
      <ul className="verification">
        {remediation.howToVerify.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>

      <ValidationBadge state={validation} />

      <details className="evidence">
        <summary>Evidence</summary>
        <dl className="evidence-list">
          <div>
            <dt>axe rule</dt>
            <dd>
              <code>{violation.id}</code>
            </dd>
          </div>
          <div>
            <dt>Rule documentation</dt>
            <dd>
              <a href={violation.helpUrl} target="_blank" rel="noreferrer">
                {violation.helpUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>WCAG reference</dt>
            <dd>
              {remediation.wcag.criterion} {remediation.wcag.name}
              {remediation.wcag.level !== "—" && ` (Level ${remediation.wcag.level})`}
            </dd>
          </div>
          <div>
            <dt>DOM snippet found</dt>
            <dd>
              <pre className="html-snippet">
                <code>{violation.nodes[0]?.html ?? "(none captured)"}</code>
              </pre>
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

export function ViolationCard({
  violation,
  pageUrl,
  expanded,
  onToggle,
}: {
  violation: Violation;
  pageUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const elementCount = violation.nodes.length;

  return (
    <article
      className={`violation-card ${expanded ? "open" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && expanded) onToggle();
      }}
    >
      <button
        type="button"
        className="violation-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <ImpactBadge impact={violation.impact} />
        <span className="violation-id">{violation.id}</span>
        <span className="violation-desc">{violation.description}</span>
        <span className="violation-count" title={`${elementCount} affected elements`}>
          {elementCount} {elementCount === 1 ? "element" : "elements"}
        </span>
        <span className="chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="violation-body">
          <WcagChips violation={violation} />

          <h4>Why it matters</h4>
          <p className="user-impact">{violation.userImpact}</p>

          <h4>Affected elements</h4>
          <ul className="nodes">
            {violation.nodes.slice(0, 5).map((node, i) => (
              <li key={i}>
                <code className="selector">{node.target || "(no selector)"}</code>
                <pre className="html-snippet">
                  <code>{node.html}</code>
                </pre>
              </li>
            ))}
          </ul>
          {violation.nodes.length > 5 && (
            <p className="muted">…and {violation.nodes.length - 5} more</p>
          )}

          <a className="help-link" href={violation.helpUrl} target="_blank" rel="noreferrer">
            Read the axe rule documentation →
          </a>

          <div className="ai-section">
            <RemediationPanel violation={violation} pageUrl={pageUrl} />
          </div>
        </div>
      )}
    </article>
  );
}
