import { readdirSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { parseRegulationMarkdown } from "../../src/domain/regulations/markdown";
import { regulationChunks } from "../../src/infrastructure/db/schema/assistant";
import type { FixtureContext } from "./shared";

export function assistantFixtures(
  ctx: FixtureContext,
  directory = new URL("../../content/regulations/", import.meta.url),
): (typeof regulationChunks.$inferInsert)[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  if (!files.length) throw new Error("Корпус положений пуст.");
  return files.flatMap((file) => {
    const docSlug = file.slice(0, -3);
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(docSlug))
      throw new Error(`Некорректный slug положения: ${file}`);
    return parseRegulationMarkdown(
      readFileSync(new URL(file, directory), "utf8"),
    ).map((chunk) => ({
      ...ctx.row(`regulation:${docSlug}:${chunk.section}`),
      docSlug,
      ...chunk,
    }));
  });
}

export async function syncRegulations(
  tx: Pick<PostgresJsDatabase, "execute" | "insert">,
  chunks: (typeof regulationChunks.$inferInsert)[],
) {
  if (!chunks.length) throw new Error("Корпус положений пуст.");
  const keys = chunks.map((chunk) => {
    if (!chunk.seedKey?.startsWith("demo:regulation:"))
      throw new Error("Некорректный ключ пункта положения.");
    return sql`${chunk.seedKey}`;
  });
  await tx.execute(
    sql`delete from regulation_chunks where seed_key like 'demo:regulation:%' and seed_key not in (${sql.join(keys, sql`, `)})`,
  );
  for (const chunk of chunks) {
    await tx
      .insert(regulationChunks)
      .values(chunk)
      .onConflictDoUpdate({
        target: regulationChunks.seedKey,
        set: {
          docSlug: chunk.docSlug,
          section: chunk.section,
          title: chunk.title,
          body: chunk.body,
        },
      });
  }
}
