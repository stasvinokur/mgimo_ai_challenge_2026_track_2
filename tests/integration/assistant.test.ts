import { describe, expect, it } from "vitest";
import { SubmitApprovedDraft } from "@/application/assistant/submit-approved";
import { ConflictError, NotFoundError } from "@/application/shared/errors";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL: журнал и подтверждение ассистента",
  () => {
    it("журнал хранит только вопрос, имена тулов и ссылки; отправка атомарна и проверяет владельца/версию", async () => {
      const student = await openStudentTestData("anna");
      const other = await openStudentTestData("timur");
      const sql = createDatabase(1);
      const ids = new UuidV7Generator();
      const clock = new FakeClock("2026-11-04T09:00:00Z");
      const uow = new DrizzleRequestsUnitOfWork(() => sql);
      try {
        const journal = new PostgresAssistantJournal(() => sql, clock, ids);
        await journal.append({
          userId: student.actor.userId,
          question: "Нужна справка для работодателя",
          tools: ["draft_request"],
          sources: ["/regulations/certificates#p-3-2"],
          outcome: "drafted",
        });
        const [log] =
          await sql`select question, tool_calls, sources, outcome from assistant_log where user_id = ${student.actor.userId}`;
        expect(log).toEqual({
          question: "Нужна справка для работодателя",
          tool_calls: ["draft_request"],
          sources: ["/regulations/certificates#p-3-2"],
          outcome: "drafted",
        });
        const { CreateRequestDraft, UpdateRequestDraft } = await import(
          "@/application/requests/drafts"
        );
        const { GetMyRequest } = await import("@/application/requests/queries");
        const { DrizzleRequestRepository } = await import(
          "@/infrastructure/db/repositories/requests/repository"
        );
        const { drizzle } = await import("drizzle-orm/postgres-js");
        const repo = new DrizzleRequestRepository(() => drizzle(sql));
        const draft = await new CreateRequestDraft(uow, clock, ids).execute(
          student.actor,
          { typeCode: "enrollment", payload: { destination: "Работодатель" } },
        );
        const detail = await new GetMyRequest(repo, clock).execute(
          student.actor,
          draft,
        );
        const approval = {
          id: ids.next(),
          draftId: detail.id,
          updatedAt: detail.updatedAt,
          payload: detail.payload,
        };
        const submit = new SubmitApprovedDraft(uow, clock, ids);
        await expect(submit.execute(other.actor, approval)).rejects.toThrow(
          NotFoundError,
        );
        await new UpdateRequestDraft(uow, clock).execute(student.actor, {
          id: draft.id,
          payload: { destination: "Другой получатель" },
        });
        await expect(submit.execute(student.actor, approval)).rejects.toThrow(
          ConflictError,
        );
        const updated = await new GetMyRequest(repo, clock).execute(
          student.actor,
          draft,
        );
        const outcomes = await Promise.allSettled([
          submit.execute(student.actor, {
            ...approval,
            payload: updated.payload,
            updatedAt: updated.updatedAt,
          }),
          submit.execute(student.actor, {
            ...approval,
            payload: updated.payload,
            updatedAt: updated.updatedAt,
          }),
        ]);
        expect(
          outcomes.filter((outcome) => outcome.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          (await new GetMyRequest(repo, clock).execute(student.actor, draft))
            .status,
        ).toBe("submitted");
        const [count] =
          await sql`select count(*)::int as n from request_events where request_id = ${draft.id} and to_status = 'submitted'`;
        expect(count?.n).toBe(1);
      } finally {
        await sql`delete from assistant_log where user_id = ${student.actor.userId}`;
        await sql.end({ timeout: 1 });
        await student.close();
        await other.close();
      }
    });
  },
);
