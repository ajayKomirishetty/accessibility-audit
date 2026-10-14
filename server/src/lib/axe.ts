import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// axe-core ships as a UMD bundle — read it once at startup, inject per page.
export const AXE_SOURCE: string = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
