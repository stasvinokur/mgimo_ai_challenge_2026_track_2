import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["student", "staff", "teacher"]);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    login: text().notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: userRole().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("users_argon2id", sql`${t.passwordHash} like '$argon2id$%'`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expiry_idx").on(t.expiresAt),
    check("sessions_sha256", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid().primaryKey(),
    key: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_attempts_key_at_idx").on(t.key, t.at),
    index("login_attempts_at_idx").on(t.at),
  ],
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: bigint({ mode: "number" }).notNull().default(0),
    transports: text().array().notNull().default(sql`'{}'::text[]`),
    deviceName: text("device_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    index("passkey_credentials_user_idx").on(t.userId),
    check("passkey_counter_range", sql`${t.counter} between 0 and 4294967295`),
    check("passkey_credential_id", sql`length(${t.credentialId}) > 0`),
    check("passkey_public_key", sql`length(${t.publicKey}) > 0`),
  ],
);

export const webauthnChallengePurpose = pgEnum("webauthn_challenge_purpose", [
  "registration",
  "authentication",
]);

export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    purpose: webauthnChallengePurpose().notNull(),
    challengeHash: text("challenge_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("webauthn_challenges_user_idx").on(t.userId),
    index("webauthn_challenges_expiry_idx").on(t.expiresAt),
    check(
      "webauthn_challenges_sha256",
      sql`${t.challengeHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check("webauthn_challenges_lifetime", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "webauthn_challenges_max_lifetime",
      sql`${t.expiresAt} <= ${t.createdAt} + interval '5 minutes'`,
    ),
    check(
      "webauthn_registration_user",
      sql`${t.purpose} <> 'registration' or ${t.userId} is not null`,
    ),
  ],
);
