import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const standalone = new URL(".next/standalone/", root);
await mkdir(new URL(".next/", standalone), { recursive: true });
await cp(new URL(".next/static/", root), new URL(".next/static/", standalone), {
  recursive: true,
});
await cp(new URL("public/", root), new URL("public/", standalone), {
  recursive: true,
});

process.env.HOSTNAME = "127.0.0.1";
process.chdir(fileURLToPath(standalone));
await import(new URL("server.js", standalone).href);
