export type Actor =
  | { kind: "student"; userId: string; studentId: string; facultyId: string }
  | {
      kind: "staff";
      userId: string;
      staffId: string;
      facultyIds: readonly string[];
    }
  | { kind: "teacher"; userId: string; teacherId: string };
