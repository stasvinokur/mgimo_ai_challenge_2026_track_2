import type { Sql } from "postgres";
import type {
  Credentials,
  IdentityRepository,
  StaffProfile,
} from "@/application/identity/ports";
import type { Actor } from "@/application/ports/actor";

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly database: () => Sql) {}

  async findCredentials(login: string): Promise<Credentials | null> {
    const [user] = await this.database()<
      Credentials[]
    >`select id as "userId", password_hash as "passwordHash" from users where login = ${login}`;
    return user ?? null;
  }

  async findActorByUserId(userId: string): Promise<Actor | null> {
    const sql = this.database();
    const [user] = await sql<
      { role: "student" | "staff" | "teacher" }[]
    >`select role from users where id = ${userId}`;
    if (user?.role === "student") {
      const [student] = await sql<
        { studentId: string; facultyId: string }[]
      >`select id as "studentId", faculty_id as "facultyId" from students where user_id = ${userId}`;
      return student ? { kind: "student", userId, ...student } : null;
    }
    if (user?.role === "teacher") {
      const [teacher] = await sql<{ teacherId: string }[]>`
        select id as "teacherId" from teachers where user_id = ${userId}`;
      return teacher ? { kind: "teacher", userId, ...teacher } : null;
    }
    if (user?.role !== "staff") return null;
    const [staff] = await sql<
      { staffId: string }[]
    >`select id as "staffId" from staff where user_id = ${userId}`;
    if (!staff) return null;
    const faculties = await sql<
      { id: string }[]
    >`select faculty_id as id from staff_faculties where staff_id = ${staff.staffId} order by faculty_id`;
    return {
      kind: "staff",
      userId,
      staffId: staff.staffId,
      facultyIds: faculties.map((row) => row.id),
    };
  }

  async findProfileForStaff(
    staffId: string,
    userId: string,
  ): Promise<StaffProfile | null> {
    const sql = this.database();
    const [profile] = await sql<
      { fullName: string }[]
    >`select full_name as "fullName" from staff where id = ${staffId} and user_id = ${userId}`;
    if (!profile) return null;
    const faculties = await sql<
      { title: string }[]
    >`select f.title from faculties f join staff_faculties sf on sf.faculty_id = f.id where sf.staff_id = ${staffId} order by f.title`;
    return { ...profile, faculties: faculties.map((row) => row.title) };
  }
}
