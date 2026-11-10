export interface AuditEntry {
  userId: string;
  action: string;
  entityId: string;
  occurredAt: string;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}
