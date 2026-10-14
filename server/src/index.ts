import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerAuditRoute } from "./routes/audit.js";
import { registerRemediateRoute } from "./routes/remediate.js";
import { registerValidateRoute } from "./routes/validate.js";
import { closeBrowser } from "./lib/browser.js";

const app = Fastify({ logger: true });

await app.register(cors);

app.get("/api/health", async () => ({
  ok: true,
  mockMode: (process.env.MOCK_MODE ?? "true").toLowerCase() !== "false",
}));

registerAuditRoute(app);
registerRemediateRoute(app);
registerValidateRoute(app);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

const shutdown = async () => {
  await closeBrowser();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
