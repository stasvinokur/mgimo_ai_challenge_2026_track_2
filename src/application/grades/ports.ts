import type { GradeWork } from "@/domain/grades/grading-policy";
import type { ScholarshipLevel } from "@/domain/grades/scholarship-policy";

export interface CourseGrades {
  id: string;
  title: string;
  works: GradeWork[];
  exams: { id: string; kind: "exam" | "credit"; at: string; room: string }[];
}

export interface GradesRecord {
  targetScore: number;
  scholarship: ScholarshipLevel;
  courses: CourseGrades[];
}

export interface GradesRepository {
  listForStudent(studentId: string): Promise<GradesRecord | null>;
  findByIdForStudent(
    courseId: string,
    studentId: string,
  ): Promise<GradesRecord | null>;
}
