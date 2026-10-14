import { readFileSync } from "node:fs";

export interface WcagRef {
  criterion: string;
  name: string;
  level: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  explanation: string;
  userImpact: string;
  wcag: WcagRef;
  fix: { before: string; after: string; language: string };
  verify: string[];
}

interface KnowledgeFile {
  entries: KnowledgeEntry[];
}

// Loaded once at startup. In production this lookup would be a vector
// retrieval (RAG) over the WCAG spec and internal guidance docs.
const file = JSON.parse(
  readFileSync(new URL("./wcag-knowledge.json", import.meta.url), "utf8")
) as KnowledgeFile;

const GENERIC: KnowledgeEntry = {
  id: "generic",
  title: "Accessibility violation",
  explanation:
    "An automated check flagged an accessibility issue on this page. The details below come from the axe-core rule documentation.",
  userImpact:
    "This kind of issue creates a barrier for people using assistive technology — typically screen reader users, keyboard-only users, or people with low vision — because the page doesn't expose the information they need in a way their tools can use.",
  wcag: { criterion: "—", name: "See the axe rule documentation", level: "—" },
  fix: {
    before: "<!-- see the offending markup above -->",
    after: "<!-- fix depends on the specific markup — see the linked rule documentation -->",
    language: "html",
  },
  verify: [
    "Apply the fix and re-run the axe-core check to confirm the rule passes.",
    "Test the affected area with keyboard only (Tab / Shift+Tab / Enter).",
    "Spot-check with a screen reader (NVDA or VoiceOver).",
  ],
};

export function getKnowledge(ruleId: string): KnowledgeEntry {
  return file.entries.find((e) => e.id === ruleId) ?? { ...GENERIC, id: ruleId };
}
