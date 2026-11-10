import type {
  Credentials,
  IdentityRepository,
  SessionTokens,
  StaffProfile,
} from "@/application/identity/ports";
import type { Actor } from "@/application/ports/actor";
import type { Clock } from "@/application/ports/clock";
import type { PasswordHasher } from "@/application/ports/password-hasher";
import type {
  RateLimiter,
  RateLimitRule,
} from "@/application/ports/rate-limiter";
import type {
  SessionRecord,
  SessionStore,
} from "@/application/ports/session-store";
import type {
  StudentProfile,
  StudentRepository,
} from "@/application/student/ports";

export const anna: Actor = {
  kind: "student",
  userId: "anna-user",
  studentId: "anna-student",
  facultyId: "fmo",
};
export const timur: Actor = {
  kind: "student",
  userId: "timur-user",
  studentId: "timur-student",
  facultyId: "imp",
};
export const marina: Actor = {
  kind: "staff",
  userId: "marina-user",
  staffId: "marina-staff",
  facultyIds: ["fmo", "imp"],
};

export class FakeIdentityRepository implements IdentityRepository {
  credentials = new Map<string, Credentials>(
    ["anna", "timur", "marina"].map((name) => [
      name,
      { userId: `${name}-user`, passwordHash: `hash:${name}-password` },
    ]),
  );
  actors: Actor[] = [anna, timur, marina];
  async findCredentials(login: string) {
    return this.credentials.get(login) ?? null;
  }
  async findActorByUserId(userId: string) {
    return structuredClone(
      this.actors.find((actor) => actor.userId === userId) ?? null,
    );
  }
  async findProfileForStaff(
    staffId: string,
    userId: string,
  ): Promise<StaffProfile | null> {
    return staffId === "marina-staff" && userId === "marina-user"
      ? { fullName: "Марина Петровна", faculties: ["ФМО", "ИМП"] }
      : null;
  }
}

export class FakeSessionStore implements SessionStore {
  records = new Map<string, SessionRecord>();
  touches = 0;
  async create(session: SessionRecord) {
    this.records.set(session.id, structuredClone(session));
  }
  async findValid(hash: string, now: Date) {
    return structuredClone(
      [...this.records.values()].find(
        (session) =>
          session.tokenHash === hash && new Date(session.expiresAt) > now,
      ) ?? null,
    );
  }
  async touch(id: string, lastSeenAt: Date, expiresAt: Date) {
    const record = this.records.get(id);
    if (record) {
      record.lastSeenAt = lastSeenAt.toISOString();
      record.expiresAt = expiresAt.toISOString();
      this.touches++;
    }
  }
  async revoke(id: string) {
    this.records.delete(id);
  }
}

export class FakeRateLimiter implements RateLimiter {
  attempts = new Map<string, { id: number; at: number }[]>();
  private sequence = 0;
  constructor(private readonly clock: Clock) {}
  async reserve(rules: readonly RateLimitRule[]) {
    const now = this.clock.now().getTime();
    if (
      rules.some(
        (rule) =>
          (this.attempts.get(rule.key) ?? []).filter(
            (row) => row.at > now - rule.windowSec * 1000,
          ).length >= rule.limit,
      )
    )
      return null;
    const reserved = rules.map((rule) => {
      const row = { id: ++this.sequence, at: now };
      this.attempts.set(rule.key, [
        ...(this.attempts.get(rule.key) ?? []),
        row,
      ]);
      return { key: rule.key, id: row.id };
    });
    let settled = false;
    return {
      async commitFailure() {
        settled = true;
      },
      release: async () => {
        if (settled) return;
        for (const { key, id } of reserved) {
          const rows = (this.attempts.get(key) ?? []).filter(
            (row) => row.id !== id,
          );
          if (rows.length) this.attempts.set(key, rows);
          else this.attempts.delete(key);
        }
        settled = true;
      },
    };
  }
}

export class FakePasswords implements PasswordHasher {
  verified: { hash: string; password: string }[] = [];
  async hash(password: string) {
    return `hash:${password}`;
  }
  async verify(hash: string, password: string) {
    this.verified.push({ hash, password });
    return hash === `hash:${password}`;
  }
}

export class FakeTokens implements SessionTokens {
  private sequence = 0;
  generate() {
    return (++this.sequence).toString(36).padStart(43, "a");
  }
  hash(value: string) {
    return `digest:${value}`;
  }
}

export class FakeStudentRepository implements StudentRepository {
  calls: string[] = [];
  profiles = new Map<string, StudentProfile>([
    [
      "anna-student",
      {
        fullName: "Анна Соколова",
        faculty: "ФМО",
        program: "Международные отношения",
        course: 2,
        group: "МО-2",
        recordBookNo: "ДЕМО-АННА",
        scholarship: "academic",
      },
    ],
    [
      "timur-student",
      {
        fullName: "Тимур Белов",
        faculty: "ИМП",
        program: "Маркетинг",
        course: 1,
        group: "М-1",
        recordBookNo: "ДЕМО-ТИМУР",
        scholarship: "none",
      },
    ],
  ]);
  async findProfileForStudent(studentId: string) {
    this.calls.push(studentId);
    return structuredClone(this.profiles.get(studentId) ?? null);
  }
}
