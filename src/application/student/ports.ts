export interface StudentProfile {
  fullName: string;
  faculty: string;
  program: string;
  course: number;
  group: string;
  recordBookNo: string;
  scholarship: "none" | "academic" | "increased";
}

export interface StudentRepository {
  findProfileForStudent(studentId: string): Promise<StudentProfile | null>;
}
