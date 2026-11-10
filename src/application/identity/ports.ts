import type { Actor } from "../ports/actor";

export interface Credentials {
  userId: string;
  passwordHash: string;
}

export interface StaffProfile {
  fullName: string;
  faculties: readonly string[];
}

export interface IdentityRepository {
  findCredentials(login: string): Promise<Credentials | null>;
  findActorByUserId(userId: string): Promise<Actor | null>;
  findProfileForStaff(
    staffId: string,
    userId: string,
  ): Promise<StaffProfile | null>;
}

export interface SessionTokens {
  generate(): string;
  hash(token: string): string;
}
