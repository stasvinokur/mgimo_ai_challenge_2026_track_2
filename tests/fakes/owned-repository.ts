export interface StudentOwnedRecord {
  id: string;
  studentId: string;
}

export class InMemoryOwnedRepository<TRecord extends StudentOwnedRecord> {
  private readonly records: readonly TRecord[];

  constructor(records: readonly TRecord[] = []) {
    this.records = structuredClone(records);
  }

  async findByIdForStudent(
    id: string,
    studentId: string,
  ): Promise<TRecord | null> {
    const record = this.records.find(
      (record) => record.id === id && record.studentId === studentId,
    );
    return record ? structuredClone(record) : null;
  }

  async listForStudent(studentId: string): Promise<TRecord[]> {
    return structuredClone(
      this.records.filter((record) => record.studentId === studentId),
    );
  }
}
