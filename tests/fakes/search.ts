import type { GradesRecord } from "@/application/grades/ports";
import type { LogContext, Logger } from "@/application/ports/logger";
import type { RegulationMatch } from "@/application/regulations/ports";
import type {
  RequestRecord,
  RequestTypeRecord,
} from "@/application/requests/ports";
import { SearchCabinet } from "@/application/search/search-cabinet";
import type { ScheduleData } from "@/domain/schedule/schedule";
import { FakeClock } from "./clock";
import { enrollmentType } from "./requests";
import { anna, scheduleData, slot } from "./schedule";

type SearchDependencies = ConstructorParameters<typeof SearchCabinet>;
type SearchSchedule = SearchDependencies[0];
type SearchGrades = SearchDependencies[1];
type SearchRequests = SearchDependencies[2];
type SearchRegulations = SearchDependencies[3];

class FakeSearchSchedule implements SearchSchedule {
  records = new Map<string, ScheduleData>();

  async findForStudent(studentId: string) {
    return structuredClone(this.records.get(studentId) ?? null);
  }
}

class FakeSearchGrades implements SearchGrades {
  calls: { studentId: string }[] = [];

  constructor(readonly records: Map<string, GradesRecord>) {}

  async listForStudent(studentId: string) {
    this.calls.push({ studentId });
    return structuredClone(this.records.get(studentId) ?? null);
  }
}

class FakeSearchRequests implements SearchRequests {
  records: RequestRecord[] = [];
  types: RequestTypeRecord[] = [structuredClone(enrollmentType)];

  async listForStudent(studentId: string) {
    return structuredClone(
      this.records.filter((record) => record.studentId === studentId),
    );
  }

  async listTypes() {
    return structuredClone(this.types);
  }
}

class FakeSearchRegulations implements SearchRegulations {
  calls: string[] = [];
  matches: RegulationMatch[] = [];

  async search(query: string) {
    this.calls.push(query);
    return structuredClone(this.matches);
  }
}

export function searchFixture() {
  const schedule = new FakeSearchSchedule();
  schedule.records.set(
    "anna",
    scheduleData({
      slots: [
        {
          ...slot,
          course: "Политическая география",
          teacher: "Артём Дёмин",
          room: "ДЕМО-102",
        },
      ],
    }),
  );
  schedule.records.set(
    "timur",
    scheduleData({
      group: "ИМП-ДЕМО-1",
      slots: [{ ...slot, id: "slot-timur", course: "Основы маркетинга" }],
    }),
  );
  const record: GradesRecord = {
    targetScore: 86,
    scholarship: "none",
    courses: [
      {
        id: "course-anna",
        title: "Политическая география",
        exams: [],
        works: [
          {
            id: "work-anna",
            title: "Эссе о регионах",
            weight: 100,
            maxScore: 100,
            score: 78,
            dueAt: "2026-11-04T21:30:00.000Z",
            isRequired: true,
          },
        ],
      },
    ],
  };
  const grades = new FakeSearchGrades(
    new Map([
      ["anna", record],
      [
        "timur",
        {
          ...record,
          courses: [
            {
              id: "course-timur",
              title: "Основы маркетинга",
              exams: [],
              works: [],
            },
          ],
        },
      ],
    ]),
  );
  const requests = new FakeSearchRequests();
  const request: RequestRecord = {
    id: "request-anna",
    publicNo: "З-2026-000002",
    studentId: "anna",
    facultyId: "fmo",
    studentUserId: "anna-user",
    typeCode: "enrollment",
    payload: {},
    status: "ready",
    assignee: null,
    submittedAt: null,
    dueAt: null,
    createdAt: "2026-11-03T09:00:00.000Z",
    updatedAt: "2026-11-03T09:00:00.000Z",
  };
  requests.records = [
    request,
    {
      ...request,
      id: "request-timur",
      publicNo: "З-2026-000999",
      studentId: "timur",
    },
  ];
  const regulations = new FakeSearchRegulations();
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const logs: { event: string; context?: LogContext }[] = [];
  const logger: Pick<Logger, "error"> = {
    error: (event, context) => {
      logs.push({ event, context });
    },
  };
  const search = new SearchCabinet(
    schedule,
    grades,
    requests,
    regulations,
    clock,
    logger,
  );
  return {
    schedule,
    grades,
    requests,
    regulations,
    clock,
    logger,
    logs,
    search,
    anna,
    record,
    request,
  };
}
