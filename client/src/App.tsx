import { useEffect, useRef, useState } from "react";
import { runAudit, type AuditResponse, type Impact } from "./api";
import { IMPACT_ORDER, ImpactBadge, ViolationCard } from "./components/ViolationCard";

type Phase = "idle" | "auditing" | "error" | "done";

const AUDIT_STEPS = [
  "Launching headless browser…",
  "Loading the page…",
  "Injecting the axe-core audit engine…",
  "Running 90+ accessibility checks…",
  "Collecting the results…",
];

export default function App() {
  const [url, setUrl] = useState("https://example.com");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const timer = useRef<number | null>(null);

  // Cycle through progress messages while the audit runs.
  useEffect(() => {
    if (phase === "auditing") {
      setStepIndex(0);
      timer.current = window.setInterval(
        () => setStepIndex((i) => (i + 1) % AUDIT_STEPS.length),
        2200
      );
    }
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [phase]);

  const startAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setPhase("auditing");
    setError("");
    setResult(null);
    setExpanded({});
    try {
      const data = await runAudit(url.trim());
      setResult(data);
      // Auto-expand the first violation so the detail view is discoverable.
      if (data.violations.length > 0) {
        setExpanded({ [data.violations[0].id]: true });
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The audit failed.");
      setPhase("error");
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const grouped = (["critical", "serious", "moderate", "minor"] as Impact[]).map(
    (impact) => ({
      impact,
      violations: (result?.violations ?? []).filter((v) => v.impact === impact),
    })
  );

  return (
    <div className="app">
      <header className="hero">
        <h1>A11y Remediation Copilot</h1>
        <p className="subtitle">
          Paste any public URL — get a real axe-core accessibility audit, then an
          AI-drafted explanation and fix for every violation.
        </p>
      </header>

      <main className="container">
        <form className="url-form" onSubmit={startAudit}>
          <label htmlFor="url-input" className="sr-only">
            URL to audit
          </label>
          <input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={phase === "auditing"}
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={phase === "auditing" || !url.trim()}
          >
            {phase === "auditing" ? "Auditing…" : "Run audit"}
          </button>
        </form>

        {phase === "auditing" && (
          <div className="status-card" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>{AUDIT_STEPS[stepIndex]}</p>
            <p className="muted small">This usually takes 5–20 seconds.</p>
          </div>
        )}

        {phase === "error" && (
          <div className="status-card error" role="alert">
            <h3>Audit failed</h3>
            <p>{error}</p>
            <button className="btn btn-secondary" onClick={() => setPhase("idle")}>
              Try another URL
            </button>
          </div>
        )}

        {/* Polite live region so screen reader users hear the outcome,
            not just the loading steps. */}
        <div className="sr-only" role="status">
          {phase === "done" && result
            ? `Audit complete: ${result.totalViolations} ${
                result.totalViolations === 1 ? "violation" : "violations"
              } found on ${result.pageTitle || result.finalUrl}.`
            : ""}
        </div>

        {phase === "done" && result && (
          <>
            <section className="result-header">
              <div>
                <h2>{result.pageTitle || "Audit results"}</h2>
                <p className="muted small">{result.finalUrl}</p>
              </div>
              {result.totalViolations === 0 ? (
                <div className="all-clear" role="status">
                  ✓ No violations found by the automated checks.
                </div>
              ) : (
                <div className="summary-cards">
                  {IMPACT_ORDER.map((impact) => (
                    <div key={impact} className={`summary-card summary-${impact}`}>
                      <span className="summary-count">{result.summary[impact] ?? 0}</span>
                      <ImpactBadge impact={impact} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {result.totalViolations > 0 && (
              <p className="muted">
                {result.totalViolations} rule violations across {result.totalElements}{" "}
                elements — sorted by impact. Expand a violation, then generate an
                AI fix.
              </p>
            )}

            {grouped.map(
              ({ impact, violations }) =>
                violations.length > 0 && (
                  <section key={impact} className="impact-group">
                    <h3 className="impact-group-title">
                      <ImpactBadge impact={impact} />
                      <span>
                        {violations.length} {violations.length === 1 ? "violation" : "violations"}
                      </span>
                    </h3>
                    {violations.map((v) => (
                      <ViolationCard
                        key={v.id}
                        violation={v}
                        pageUrl={result.finalUrl}
                        expanded={!!expanded[v.id]}
                        onToggle={() => toggle(v.id)}
                      />
                    ))}
                  </section>
                )
            )}
          </>
        )}
      </main>

      <footer className="footer">
        <p>
          Proof of concept — automated checks only catch a fraction of real
          accessibility barriers. The most important testing is done with people
          with disabilities.
        </p>
      </footer>
    </div>
  );
}
