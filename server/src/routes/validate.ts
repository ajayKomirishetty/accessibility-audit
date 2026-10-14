import type { FastifyInstance } from "fastify";
import { validateFix, MAX_SNIPPET_LEN } from "../lib/validate.js";

interface ValidateFixBody {
  htmlSnippet?: unknown;
  ruleId?: unknown;
}

export function registerValidateRoute(app: FastifyInstance) {
  app.post("/api/validate-fix", async (req, reply) => {
    const body = (req.body ?? {}) as ValidateFixBody;
    if (typeof body.htmlSnippet !== "string" || !body.htmlSnippet.trim()) {
      return reply.code(400).send({ error: 'Provide an "htmlSnippet" string to validate.' });
    }
    if (body.htmlSnippet.length > MAX_SNIPPET_LEN) {
      return reply
        .code(400)
        .send({ error: `htmlSnippet is too long (max ${MAX_SNIPPET_LEN} characters).` });
    }
    if (typeof body.ruleId !== "string" || !body.ruleId.trim()) {
      return reply.code(400).send({ error: 'Provide the axe "ruleId" to check against.' });
    }

    try {
      return await validateFix(body.htmlSnippet, body.ruleId.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error(err);
      // axe throws for unknown rule ids — that's a client error, not a crash.
      if (/no rules|unknown rule|invalid/i.test(msg)) {
        return reply.code(400).send({ error: `Unknown axe rule id: "${body.ruleId}".` });
      }
      if (/timeout/i.test(msg)) {
        return reply.code(504).send({ error: "The validation run timed out. Try again." });
      }
      return reply.code(500).send({ error: `Validation failed: ${msg}` });
    }
  });
}
