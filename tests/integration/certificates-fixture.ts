import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { PostgresCertificateRepository } from "@/infrastructure/db/repositories/certificates/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { PostgresStudentRepository } from "@/infrastructure/db/repositories/student/profile";
import { openStaffFixture } from "./staff-fixtures";
import { openStudentTestData } from "./student-e2e-data";

export async function openCertificatesFixture() {
  const staff = await openStaffFixture();
  let anna: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
  let timur: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
  try {
    anna = await openStudentTestData("anna");
    timur = await openStudentTestData("timur");
    const owner = anna;
    const other = timur;
    const uow = new DrizzleRequestsUnitOfWork(() => staff.sql);
    const change = new ChangeRequestStatus(uow, staff.clock, staff.ids);
    const create = new CreateRequestDraft(uow, staff.clock, staff.ids);
    const submit = new SubmitRequest(change);
    const repo = new PostgresCertificateRepository(() => staff.sql);
    return {
      anna: owner,
      timur: other,
      staff,
      repo,
      students: new PostgresStudentRepository(() => staff.sql),
      async request(
        status: "submitted" | "ready" | "issued" = "ready",
        input: { typeCode: string; payload: Record<string, unknown> } = {
          typeCode: "enrollment",
          payload: { destination: "Учебная организация «Пример»" },
        },
      ) {
        const request = await create.execute(owner.actor, {
          typeCode: input.typeCode,
          payload: input.payload,
        });
        await submit.execute(owner.actor, request);
        if (status !== "submitted")
          for (const to of ["accepted", "in_progress", "ready"] as const)
            await staff.change.execute(staff.limited, { id: request.id, to });
        if (status === "issued")
          await staff.change.execute(staff.limited, {
            id: request.id,
            to: "issued",
          });
        return {
          id: request.id,
          certificate: await repo.findByRequestIdForStudent(
            request.id,
            owner.actor.studentId,
          ),
        };
      },
      async revoke(id: string) {
        await staff.sql`update certificates set revoked_at = now() where request_id = ${id}`;
      },
      async close() {
        try {
          await owner.close();
          await other.close();
        } finally {
          await staff.close();
        }
      },
    };
  } catch (error) {
    try {
      await anna?.close();
      await timur?.close();
    } finally {
      await staff.close();
    }
    throw error;
  }
}
