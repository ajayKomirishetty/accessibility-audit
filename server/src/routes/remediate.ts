import type { FastifyInstance } from "fastify";
import { getRemediation, type ViolationInput } from "../lib/remediate.js";

interface RemediateBody {
  violation?: Partial<ViolationInput> | null;
  url?: string;
}

export function registerRemediateRoute(app: FastifyInstance) {
  app.post("/api/remediate", async (req, reply) => {
    const body = (req.body ?? {}) as RemediateBody;
    const v = body.violation;
    if (!v || typeof v.id !== "string" || typeof v.description !== "string") {
      return reply.code(400).send({
        error:
          'Provide a violation object with at least { id, description }, e.g. { "violation": { "id": "image-alt", "impact": "critical", "description": "...", "wcagTags": ["wcag2a"], "html": "<img ...>" } }.',
      });
    }

    try {
      return await getRemediation(
        {
          id: v.id,
          impact: typeof v.impact === "string" ? v.impact : "minor",
          description: v.description,
          wcagTags: Array.isArray(v.wcagTags) ? v.wcagTags.filter((t) => typeof t === "string") : [],
          html: typeof v.html === "string" ? v.html : "",
        },
        typeof body.url === "string" ? body.url : undefined
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error(err);
      if (/timeout/i.test(msg)) {
        return reply.code(504).send({ error: "The AI request timed out. Try again." });
      }
      return reply.code(502).send({ error: `Couldn't generate a fix: ${msg}` });
    }
  });
}
