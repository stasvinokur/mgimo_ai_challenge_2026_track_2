import { mkdir, writeFile } from "node:fs/promises";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ai-sdk-ollama";
import { fixtures, instructions } from "./fixtures.js";
import { measure, probeRepair, safeError, summarize } from "./runtime.js";

class ConfigurationError extends Error {}

async function main() {
  if (process.env.ENV_FILE) {
    try {
      process.loadEnvFile(process.env.ENV_FILE);
    } catch {
      throw new ConfigurationError(
        "Не удалось загрузить ENV_FILE. Проверьте доступность файла; его содержимое не выводится.",
      );
    }
  }
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (!apiKey)
    throw new ConfigurationError(
      "Не задан OLLAMA_API_KEY. Передайте ENV_FILE с ключом или задайте ключ в окружении сервера.",
    );
  const args = process.argv.slice(2);
  const runsArg = args.find((arg) => arg.startsWith("--runs="));
  const runs = runsArg ? Number(runsArg.split("=")[1]) : 2;
  if (!Number.isInteger(runs) || runs < 1 || runs > 3)
    throw new ConfigurationError(
      "Число прогонов --runs должно быть от 1 до 3.",
    );
  if (
    args.some(
      (arg) =>
        !arg.startsWith("--runs=") &&
        !arg.startsWith("--stream-model=") &&
        arg !== "--catalog" &&
        arg !== "--stream-only",
    )
  )
    throw new ConfigurationError(
      "Неизвестный аргумент. Допустимы --runs=1..3, --catalog, --stream-only, --stream-model=имя.",
    );
  const catalogResponse = await fetch("https://ollama.com/api/tags", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!catalogResponse.ok)
    throw new ConfigurationError(
      `Каталог Ollama недоступен: HTTP ${catalogResponse.status}.`,
    );
  const catalog = (await catalogResponse.json()).models.map(
    (model) => model.name,
  );
  if (args.includes("--catalog")) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }
  const names = ["deepseek-v4.1-flash", "gpt-oss:120b", "glm-5.3-flash"];
  const streamModel =
    args.find((arg) => arg.startsWith("--stream-model="))?.split("=")[1] ??
    names[0];
  if (!names.includes(streamModel))
    throw new ConfigurationError(
      "Неизвестная модель стрима: выберите одну из трёх моделей стенда.",
    );
  if (names.some((name) => !catalog.includes(name)))
    throw new ConfigurationError(
      "Не все три модели фикстуры доступны в текущем каталоге Ollama.",
    );
  const ollama = createOllama({ baseURL: "https://ollama.com", apiKey });
  const compatible = createOpenAICompatible({
    name: "ollama-cloud",
    baseURL: "https://ollama.com/v1",
    apiKey,
  });
  const result = {
    date: new Date().toISOString(),
    versions: {
      ai: "7.0.162",
      ollama: "4.6.2",
      compatible: "3.0.84",
      zod: "4.6.7",
    },
    instructions,
    fixtures,
    settings: {
      temperature: 0,
      maxOutputTokens: 2048,
      maxRetries: 0,
      timeoutMs: 60000,
      reliableToolCalling: false,
      reliableObjectGeneration: false,
      maxSteps: 2,
    },
    runs,
    catalog,
    models: {},
    streaming: [],
    repairProbes: [],
  };
  const outputDirectory = new URL("./results/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  const output = new URL(
    args.includes("--stream-only")
      ? `streaming-${streamModel.replaceAll(/[^a-z0-9-]/gi, "-")}.json`
      : "measurements.json",
    outputDirectory,
  );
  const save = () =>
    writeFile(
      output,
      `${JSON.stringify(result, null, 2).replaceAll(apiKey, "[секрет удалён]")}\n`,
    );
  if (!args.includes("--stream-only")) {
    // Sequential requests avoid queue contention distorting per-model latency.
    for (let run = 1; run <= runs; run++) {
      for (const name of names) {
        const model = ollama(name, {
          reliableToolCalling: false,
          reliableObjectGeneration: false,
        });
        result.models[name] ??= { samples: [], summary: null };
        for (const fixture of fixtures) {
          const sample = await measure(model, fixture);
          result.models[name].samples.push({ run, ...sample });
          result.models[name].summary = summarize(result.models[name].samples);
          await save();
          console.log(
            `${name} · ${run}/${runs} · ${fixture.id}: ${sample.error ?? (sample.correctTool && sample.expectedArguments ? "верно" : "ошибка выбора или аргументов")} · ${sample.latencyMs} мс`,
          );
        }
      }
    }
  }
  for (const [provider, model] of [
    [
      "ai-sdk-ollama",
      ollama(streamModel, {
        reliableToolCalling: false,
        reliableObjectGeneration: false,
      }),
    ],
    ["openai-compatible", compatible(streamModel)],
  ]) {
    for (const id of ["employer", "what-if", "other-student", "weather"]) {
      const fixture = fixtures.find((item) => item.id === id);
      const sample = await measure(model, fixture, { stream: true });
      result.streaming.push({ provider, model: streamModel, ...sample });
      await save();
      console.log(
        `Стрим ${provider} · ${id}: ${sample.error ?? "завершён"} · ${sample.textChunks} фрагментов текста`,
      );
    }
    const repair = await probeRepair(model);
    result.repairProbes.push({ provider, model: streamModel, ...repair });
    await save();
    console.log(
      `Repair ${provider}: ${repair.valid ? "валиден" : (repair.error ?? "не исправлен")}`,
    );
  }
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(result.models).map(([name, entry]) => [
          name,
          entry.summary,
        ]),
      ),
      null,
      2,
    ),
  );
  console.log(
    `Результаты: scripts/spikes/assistant/results/${output.pathname.split("/").at(-1)}`,
  );
}

main().catch((error) => {
  // Never print SDK exceptions: they can contain request headers or response bodies.
  console.error(
    error instanceof ConfigurationError ? error.message : safeError(error),
  );
  process.exitCode = 1;
});
