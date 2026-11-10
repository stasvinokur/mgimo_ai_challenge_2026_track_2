import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchRegulations } from "@/application/regulations/use-cases";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRegulations } from "@/infrastructure/db/repositories/regulations/repository";
import { regulationChunks as chunks } from "@/infrastructure/db/schema/assistant";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import {
  assistantFixtures,
  syncRegulations,
} from "../../scripts/fixtures/assistant";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { seedDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)("PostgreSQL: regulations", () => {
  const sql = createDatabase(1);
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const ids = new UuidV7Generator();
  const repository = new PostgresRegulations(() => sql);
  beforeAll(() => seedDemo(sql, clock), 30_000);
  afterAll(() => sql.end({ timeout: 1 }));

  it.each([
    ["хакатон освобождение", "attendance", "4"],
    ["справка для работодателя", "certificates", "3.2"],
    ["повышенная стипендия", "scholarship", "2"],
    ["повышенные стипендии", "scholarship", "2"],
    ["Сколько дней оформляется справка для визы?", "certificates", "3.4"],
    ["Как получить справку для военкомата?", "certificates", "3.3"],
  ])(
    "FTS russian: %s → %s § %s с текстовыми маркерами",
    async (query, slug, section) => {
      const useCase = new SearchRegulations(repository);
      const results = await useCase.execute(
        {
          kind: "student",
          userId: "anna",
          studentId: "anna",
          facultyId: "fmo",
        },
        { query },
      );
      expect(results.length).toBeLessThanOrEqual(5);
      const result = results.find(
        (r) => r.slug === slug && r.section === section,
      );
      expect(result).toBeDefined();
      expect(result?.documentTitle).toBeTruthy();
      expect(result?.excerpt).toContain("[[[");
      expect(result?.excerpt).not.toMatch(/<\/?[a-z]/i);
      expect(result?.href).toBe(
        `/regulations/${slug}#p-${section.replaceAll(".", "-")}`,
      );
      expect(results[0]?.slug).toBe(slug);
      expect(results[0]?.section).toBe(section);
    },
  );

  it("FTS: нет результатов, кавычки и SQL не становятся кодом", async () => {
    expect(await repository.search("несуществующеесловоъ")).toEqual([]);
    await expect(
      repository.search("'; drop table regulation_chunks; --"),
    ).resolves.toEqual([]);
    expect(await repository.list()).toHaveLength(8);
    expect(await repository.findBySlug("unknown")).toEqual([]);
    expect(await repository.search("и в на")).toEqual([]);
  });
  it("fallback отсекает слабые совпадения и не дублирует строгие результаты", async () => {
    const natural = await repository.search(
      "Сколько дней оформляется справка для визы?",
    );
    expect(natural.map((row) => [row.slug, row.section])).toEqual([
      ["certificates", "3.4"],
    ]);
    expect(natural[0]?.excerpt).toContain("5 рабочих");
    expect(natural[0]?.excerpt).toContain("PDF");
    const strict = await repository.search("справка для работодателя");
    expect(strict[0]).toMatchObject({ slug: "certificates", section: "3.2" });
    expect(strict.length).toBeGreaterThan(1);
    expect(
      new Set(strict.map((row) => `${row.slug}:${row.section}`)).size,
    ).toBe(strict.length);
    expect(strict.length).toBeLessThanOrEqual(5);
  });
  it("строгое совпадение предшествует даже более сильному частичному", async () => {
    const rollback = new Error("Откат проверки приоритета поиска");
    await expect(
      sql.begin(async (tx) => {
        const slug = "regulations-search-order-test";
        await tx`insert into regulation_chunks (id, doc_slug, section, title, body) values
        (${ids.next()}, ${slug}, '0', 'Проверка поиска', 'Вымышленный документ'),
        (${ids.next()}, ${slug}, '1', 'Строгий пункт', ${`strictanchor ${"заполнитель ".repeat(80)}partialanchor`}),
        (${ids.next()}, ${slug}, '2', 'Частичный пункт', ${"strictanchor ".repeat(80)})`;
        const results = await new PostgresRegulations(
          () => tx as unknown as Sql,
        ).search("strictanchor partialanchor");
        expect(results.map((row) => row.section)).toEqual(["1", "2"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("фрагмент настоящего пункта содержит текст ссылки без markdown и URL", async () => {
    const results = await repository.search("Условия назначения");
    const result = results.find(
      (row) => row.slug === "certificates" && row.section === "3.5",
    );
    expect(result?.excerpt).toContain("положении о стипендиях");
    expect(result?.excerpt).toContain("[[[");
    expect(result?.excerpt).not.toMatch(/\]\(|\/regulations\//);
  });

  it("до ts_headline убираются ссылки, заголовки, списки, выделение и код; маркеры сохранены", async () => {
    const rollback = new Error("Откат проверки фрагмента");
    await expect(
      sql.begin(async (tx) => {
        const slug = "regulations-formatting-test";
        const body =
          "## **Контроль**\n- [Учебное правило](/regulations/scholarship#p-2)\n* *курсив* и `код`\n1. Первый пункт\n+ **Второй пункт**\n[[[маркер]]] завершающий текст";
        await tx`insert into regulation_chunks (id, doc_slug, section, title, body) values
        (${ids.next()}, ${slug}, '0', 'Учебный документ', 'Вымышленное положение конкурсного концепта.'),
        (${ids.next()}, ${slug}, '1', 'Форматирование', ${body})`;
        const results = await new PostgresRegulations(
          () => tx as unknown as Sql,
        ).search("Контроль");
        const result = results.find((row) => row.slug === slug);
        expect(result?.excerpt).toContain("Учебное правило");
        expect(result?.excerpt).toContain("курсив и код");
        expect(result?.excerpt).toContain("[[[маркер]]]");
        const plain = result?.excerpt
          .replaceAll("[[[", "")
          .replaceAll("]]]", "");
        expect(plain).toBe(
          "Контроль Учебное правило курсив и код Первый пункт Второй пункт маркер завершающий текст",
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("два полных сида сохраняют UUID и записи без дубликатов", async () => {
    const snapshot = () =>
      sql`select * from regulation_chunks order by doc_slug, section`;
    const before = await snapshot();
    await seedDemo(sql, clock);
    await seedDemo(sql, clock);
    expect(await snapshot()).toEqual(before);
    expect((await repository.list()).map((r) => r.slug)).not.toContain(
      "demo-scholarship",
    );
  }, 30_000);

  it("удалённый из markdown пункт исчезает; upsert обновляет тело; пользовательские записи сохранены", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pulse-regulations-"));
    const rollback = new Error("Откат проверки корпуса");
    try {
      await cp(
        new URL("../../content/regulations/", import.meta.url),
        directory,
        { recursive: true },
      );
      const file = join(directory, "scholarship.md");
      const original = await readFile(file, "utf8");
      await writeFile(
        file,
        original
          .replace(/\n## 4[\s\S]*$/, "\n")
          .replace("Прогноз помогает", "Учебный прогноз помогает"),
      );
      await expect(
        drizzle(sql).transaction(async (tx) => {
          const existing = await tx
            .select({ seedKey: chunks.seedKey, id: chunks.id })
            .from(chunks);
          const ctx = fixtureContext(
            clock,
            ids,
            new Map(
              existing.flatMap((r) =>
                r.seedKey ? [[r.seedKey, r.id] as const] : [],
              ),
            ),
          );
          const first = ids.next();
          const second = ids.next();
          await tx.insert(chunks).values([
            {
              id: first,
              seedKey: null,
              docSlug: "user-document",
              section: "1",
              title: "Личное правило",
              body: "Сохранить",
            },
            {
              id: second,
              seedKey: "user:rule",
              docSlug: "user-document",
              section: "2",
              title: "Ещё правило",
              body: "Сохранить",
            },
          ]);
          const userSnapshot = () =>
            tx
              .select()
              .from(chunks)
              .where(eq(chunks.docSlug, "user-document"))
              .orderBy(chunks.section);
          const before = await userSnapshot();
          const fixtures = assistantFixtures(
            ctx,
            pathToFileURL(`${directory}/`),
          );
          await syncRegulations(tx, fixtures);
          await syncRegulations(tx, fixtures);
          expect(
            await tx
              .select()
              .from(chunks)
              .where(
                and(eq(chunks.docSlug, "scholarship"), eq(chunks.section, "4")),
              ),
          ).toHaveLength(0);
          const [updated] = await tx
            .select()
            .from(chunks)
            .where(
              and(eq(chunks.docSlug, "scholarship"), eq(chunks.section, "1")),
            );
          expect(updated?.body).toContain("Учебный прогноз помогает");
          expect(await userSnapshot()).toEqual(before);
          expect(
            await tx
              .select()
              .from(chunks)
              .where(eq(chunks.docSlug, "demo-certificates")),
          ).toHaveLength(0);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(
        (await repository.findBySlug("scholarship")).some(
          (r) => r.section === "4",
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
