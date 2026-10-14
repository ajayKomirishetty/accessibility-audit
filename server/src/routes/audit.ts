import type { FastifyInstance } from "fastify";
import { validateAuditUrl } from "../lib/ssrf.js";
import { runAudit } from "../lib/audit.js";

export function registerAuditRoute(app: FastifyInstance) {
  app.post("/api/audit", async (req, reply) => {
    const body = req.body as { url?: unknown } | null;
    if (!body || typeof body.url !== "string" || !body.url.trim()) {
      return reply
        .code(400)
        .send({ error: 'Provide a URL to audit, e.g. { "url": "https://example.com" }.' });
    }

    let url: string;
    try {
      url = await validateAuditUrl(body.url);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    try {
      return await runAudit(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error(err);
      if (/timeout/i.test(msg)) {
        return reply
          .code(504)
          .send({ error: "The page took too long to load (gave up after ~25s)." });
      }
      if (/net::|ERR_|navigation|resolve|blocked/i.test(msg)) {
        return reply.code(502).send({
          error:
            "Couldn't load the page in a headless browser — it may be blocking automated traffic. " +
            `Detail: ${msg}`,
        });
      }
      return reply.code(500).send({ error: `Audit failed: ${msg}` });
    }
  });
}
