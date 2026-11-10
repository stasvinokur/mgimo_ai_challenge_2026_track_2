import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const stage = new URL(".next/base-path-smoke/", root);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
// Whitelist source inputs: never copy .env files or another build.
for (const name of [
  "src",
  "public",
  "next.config.ts",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
])
  await cp(new URL(name, root), new URL(name, stage), { recursive: true });
await symlink(
  fileURLToPath(new URL("node_modules", root)),
  new URL("node_modules", stage),
  "dir",
);
const config = new URL("next.config.ts", stage);
await writeFile(
  config,
  (await readFile(config, "utf8")).replace(
    "export default nextConfig;",
    `nextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(fileURLToPath(root))} };\nnextConfig.outputFileTracingRoot = ${JSON.stringify(fileURLToPath(root))};\nexport default nextConfig;`,
  ),
);

let stopping = false;
async function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: fileURLToPath(stage),
    env: { ...process.env, BASE_PATH: "/dekanat", ...extraEnv },
    stdio: "inherit",
  });
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 || stopping
          ? resolve()
          : reject(new Error("Сервер проверки /dekanat завершился с ошибкой.")),
      );
    });
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

await run("pnpm", ["build"]);
if (!stopping && !process.argv.includes("--build-only")) {
  const standalone = new URL(".next/standalone/.next/base-path-smoke/", stage);
  await mkdir(new URL(".next/", standalone), { recursive: true });
  await cp(
    new URL(".next/static/", stage),
    new URL(".next/static/", standalone),
    { recursive: true },
  );
  await cp(new URL("public/", stage), new URL("public/", standalone), {
    recursive: true,
  });
  // A loopback-only fixture exercises the app's real speech endpoint without a model.
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0);
  wav.write("WAVE", 8);
  const speech = createServer((request, response) => {
    request.resume();
    response.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": wav.length,
    });
    response.end(wav);
  });
  speech.listen(0, "127.0.0.1");
  await once(speech, "listening");
  const address = speech.address();
  try {
    await run(
      process.execPath,
      [fileURLToPath(new URL("server.js", standalone))],
      {
        HOSTNAME: "127.0.0.1",
        ASSISTANT_RUNTIME: "mock",
        TTS_URL: `http://127.0.0.1:${address.port}`,
      },
    );
  } finally {
    speech.closeAllConnections();
    speech.close();
  }
}
