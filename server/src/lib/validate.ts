import { newContext } from "./browser.js";
import { AXE_SOURCE } from "./axe.js";

export interface FixValidation {
  passes: boolean;
  remainingViolations: string[];
}

export const MAX_SNIPPET_LEN = 50_000;

/**
 * Validates a proposed fix: renders the HTML snippet inside a minimal blank
 * page in headless Chromium and re-runs axe-core scoped to the single rule.
 * This turns "the LLM thinks it's fixed" into "an automated check confirmed it".
 */
export async function validateFix(htmlSnippet: string, ruleId: string): Promise<FixValidation> {
  const context = await newContext();
  const page = await context.newPage();
  try {
    // Snippets aren't full documents — wrap them so axe has a page to run on.
    const doc =
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<title>Fix check</title></head><body>${htmlSnippet}</body></html>`;
    await page.setContent(doc, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.addScriptTag({ content: AXE_SOURCE });
    // ruleId is JSON-encoded into the evaluated string so it's safely quoted.
    const raw = (await page.evaluate(
      `window.axe.run(document, { runOnly: { type: "rule", values: [${JSON.stringify(ruleId)}] } })`
    )) as unknown as { violations: { id: string }[] };
    const remaining = (raw.violations ?? []).map((v) => v.id);
    return { passes: remaining.length === 0, remainingViolations: remaining };
  } finally {
    await context.close().catch(() => {});
  }
}
