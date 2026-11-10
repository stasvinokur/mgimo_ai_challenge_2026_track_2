import type { TransactionSql } from "postgres";
import { afterAll, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";

const sql = createDatabase(1);
const ids = new UuidV7Generator();
afterAll(() => sql.end({ timeout: 1 }));

async function rollback(action: (tx: TransactionSql) => Promise<void>) {
  const marker = new Error("Откат временных данных M5");
  await expect(
    sql.begin(async (tx) => {
      await action(tx);
      throw marker;
    }),
  ).rejects.toBe(marker);
}

async function rejected(
  tx: TransactionSql,
  action: (db: TransactionSql) => Promise<unknown>,
  code: string,
  constraint?: string,
) {
  await expect(tx.savepoint(action)).rejects.toMatchObject({
    code,
    ...(constraint ? { constraint_name: constraint } : {}),
  });
}

async function user(tx: TransactionSql) {
  const id = ids.next();
  await tx`insert into users (id, login, password_hash, role)
    values (${id}, ${`m5-test-${id}`}, '$argon2id$test-fixture', 'student')`;
  return id;
}

async function academicContext(tx: TransactionSql) {
  const owner = await user(tx);
  const author = await user(tx);
  const student = ids.next();
  const request = ids.next();
  const window = ids.next();
  await tx`insert into students (id, user_id, full_name, faculty_id, program_id, course, group_id, record_book_no)
    select ${student}, ${owner}, 'Учебный студент M5', faculty_id, program_id, course, group_id, ${`M5-${student}`}
    from students where seed_key = 'demo:student:anna'`;
  await tx`insert into requests (id, public_no, student_id, type_code, payload, status)
    values (${request}, ${`M5-${request}`}, ${student}, 'enrollment', '{}', 'ready')`;
  await tx`insert into pickup_windows (id, faculty_id, title, opens_at, closes_at)
    select ${window}, faculty_id, 'Учебное окно M5', '09:00', '17:00'
    from students where id = ${student}`;
  const [assessment] = await tx<
    { id: string }[]
  >`select id from assessments order by seed_key limit 1`;
  if (!assessment) throw new Error("Нужен демо-сид с учебными работами.");
  return { owner, author, student, request, window, assessment: assessment.id };
}

it("challenge хранится только хэшем, уникален и живёт не больше пяти минут", async () => {
  const columns = await sql<
    { column_name: string }[]
  >`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'webauthn_challenges' order by ordinal_position`;
  expect(columns.map((row) => row.column_name)).toEqual([
    "id",
    "user_id",
    "purpose",
    "challenge_hash",
    "created_at",
    "expires_at",
    "used_at",
  ]);
  await rollback(async (tx) => {
    const owner = await user(tx);
    const challenge = ids.next();
    const hash = "a".repeat(64);
    await tx`insert into webauthn_challenges (id, user_id, purpose, challenge_hash, created_at, expires_at)
      values (${challenge}, ${owner}, 'registration', ${hash}, '2035-01-01T00:00:00Z', '2035-01-01T00:05:00Z')`;
    await tx`update webauthn_challenges set used_at = created_at + interval '1 minute' where id = ${challenge}`;
    expect(
      await tx`select id from webauthn_challenges where id = ${challenge} and used_at is not null`,
    ).toHaveLength(1);
    await rejected(
      tx,
      (
        db,
      ) => db`insert into webauthn_challenges (id, purpose, challenge_hash, created_at, expires_at)
      values (${ids.next()}, 'authentication', ${hash}, now(), now() + interval '1 minute')`,
      "23505",
    );
    await rejected(
      tx,
      (db) =>
        db`update webauthn_challenges set challenge_hash = 'открытый challenge' where id = ${challenge}`,
      "23514",
      "webauthn_challenges_sha256",
    );
    await rejected(
      tx,
      (db) =>
        db`update webauthn_challenges set expires_at = created_at + interval '300.001 seconds' where id = ${challenge}`,
      "23514",
      "webauthn_challenges_max_lifetime",
    );
    await rejected(
      tx,
      (db) =>
        db`update webauthn_challenges set expires_at = created_at where id = ${challenge}`,
      "23514",
      "webauthn_challenges_lifetime",
    );
    await rejected(
      tx,
      (db) =>
        db`update webauthn_challenges set user_id = null where id = ${challenge}`,
      "23514",
      "webauthn_registration_user",
    );
    await tx`insert into webauthn_challenges (id, purpose, challenge_hash, created_at, expires_at)
      values (${ids.next()}, 'authentication', ${"b".repeat(64)}, now(), now() + interval '1 minute')`;
  });
});

it("ключ доступа уникален, счётчик неотрицательный и поддерживает uint32", async () => {
  await rollback(async (tx) => {
    const owner = await user(tx);
    const id = ids.next();
    await tx`insert into passkey_credentials (id, user_id, credential_id, public_key, counter, transports, device_name)
      values (${id}, ${owner}, 'm5-credential', 'test-public-key', 4294967295, array['internal'], 'Учебный телефон')`;
    await rejected(
      tx,
      (
        db,
      ) => db`insert into passkey_credentials (id, user_id, credential_id, public_key, device_name)
      values (${ids.next()}, ${owner}, 'm5-credential', 'test-public-key', 'Учебный компьютер')`,
      "23505",
    );
    for (const counter of [-1, 4294967296]) {
      await rejected(
        tx,
        (db) =>
          db`update passkey_credentials set counter = ${counter} where id = ${id}`,
        "23514",
        "passkey_counter_range",
      );
    }
  });
});

it("push-подписки требуют уникальный HTTPS endpoint и неотрицательный счётчик сбоев", async () => {
  await rollback(async (tx) => {
    const owner = await user(tx);
    const id = ids.next();
    await tx`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${id}, ${owner}, 'https://push.example.invalid/m5', 'test-public-key', 'test-auth')`;
    await rejected(
      tx,
      (
        db,
      ) => db`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${ids.next()}, ${owner}, 'https://push.example.invalid/m5', 'other-key', 'other-auth')`,
      "23505",
    );
    for (const endpoint of [
      "http://push.example.invalid/m5",
      "https://",
      "ftp://push.example.invalid/m5",
    ]) {
      await rejected(
        tx,
        (db) =>
          db`update push_subscriptions set endpoint = ${endpoint} where id = ${id}`,
        "23514",
        "push_endpoint_https",
      );
    }
    await rejected(
      tx,
      (db) => db`update push_subscriptions set failures = -1 where id = ${id}`,
      "23514",
      "push_failures_nonnegative",
    );
    await tx`update push_subscriptions set failures = failures + 1 where id = ${id}`;
  });
});

it("активные booked/called занимают единственные слот окна и запись на заявку", async () => {
  await rollback(async (tx) => {
    const f = await academicContext(tx);
    const secondRequest = ids.next();
    const secondWindow = ids.next();
    const booking = ids.next();
    await tx`insert into requests (id, public_no, student_id, type_code, payload, status)
      values (${secondRequest}, ${`M5-${secondRequest}`}, ${f.student}, 'enrollment', '{}', 'ready')`;
    await tx`insert into pickup_windows (id, faculty_id, title, opens_at, closes_at)
      select ${secondWindow}, faculty_id, 'Учебное окно 2', opens_at, closes_at from pickup_windows where id = ${f.window}`;
    await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
      values (${booking}, ${f.owner}, ${f.request}, ${f.window}, '2035-01-01T06:00:00Z', 'У-001')`;
    for (const status of ["booked", "called"]) {
      await tx`update pickup_bookings set status = ${status} where id = ${booking}`;
      await rejected(
        tx,
        (
          db,
        ) => db`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
        values (${ids.next()}, ${f.owner}, ${secondRequest}, ${f.window}, '2035-01-01T06:00:00Z', 'У-002')`,
        "23505",
        "pickup_bookings_active_slot_unique",
      );
      await rejected(
        tx,
        (
          db,
        ) => db`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
        values (${ids.next()}, ${f.owner}, ${f.request}, ${secondWindow}, '2035-01-01T06:10:00Z', 'У-003')`,
        "23505",
        "pickup_bookings_active_request_unique",
      );
    }
    await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
      values (${ids.next()}, ${f.owner}, ${secondRequest}, ${secondWindow}, '2035-01-01T06:00:00Z', 'У-004')`;
    await rejected(
      tx,
      (db) =>
        db`update pickup_bookings set slot_starts_at = '2035-01-01T06:11:00Z' where id = ${booking}`,
      "23514",
      "pickup_bookings_ten_minute_slot",
    );
    await rejected(
      tx,
      (db) =>
        db`update pickup_bookings set slot_starts_at = '2035-01-01T06:10:00.001Z' where id = ${booking}`,
      "23514",
      "pickup_bookings_ten_minute_slot",
    );
    await rejected(
      tx,
      (db) =>
        db`update pickup_windows set closes_at = opens_at where id = ${f.window}`,
      "23514",
      "pickup_windows_hours",
    );
  });
});

it.each(["served", "cancelled", "no_show"])(
  "статус %s освобождает слот и заявку, история остаётся",
  async (status) => {
    await rollback(async (tx) => {
      const f = await academicContext(tx);
      await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no, status)
      values (${ids.next()}, ${f.owner}, ${f.request}, ${f.window}, '2035-01-01T06:00:00Z', 'У-001', ${status})`;
      await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
      values (${ids.next()}, ${f.owner}, ${f.request}, ${f.window}, '2035-01-01T06:00:00Z', 'У-002')`;
      expect(
        await tx`select id from pickup_bookings where request_id = ${f.request}`,
      ).toHaveLength(2);
    });
  },
);

it("история баллов требует причину изменения, максимум 300 Unicode-символов", async () => {
  await rollback(async (tx) => {
    const f = await academicContext(tx);
    const id = ids.next();
    await tx`insert into score_events (id, assessment_id, student_id, student_user_id, previous_score, new_score, changed_by_user_id, reason)
      values (${id}, ${f.assessment}, ${f.student}, ${f.owner}, 78, 80, ${f.author}, ${"🙂".repeat(300)})`;
    await rejected(
      tx,
      (db) =>
        db`update score_events set reason = ${"я".repeat(301)} where id = ${id}`,
      "23514",
      "score_events_reason_length",
    );
    for (const reason of [null, "   "]) {
      await rejected(
        tx,
        (db) => db`update score_events set reason = ${reason} where id = ${id}`,
        "23514",
        "score_events_change_reason",
      );
    }
    await rejected(
      tx,
      (db) => db`update score_events set new_score = -1 where id = ${id}`,
      "23514",
      "score_events_nonnegative",
    );
    await tx`insert into score_events (id, assessment_id, student_id, new_score, changed_by_user_id)
      values (${ids.next()}, ${f.assessment}, ${f.student}, 75, ${f.author})`;
  });
});

it("шаг онбординга уникален по пользователю и коду", async () => {
  await rollback(async (tx) => {
    const owner = await user(tx);
    const other = await user(tx);
    await tx`insert into onboarding_steps (user_id, step_code) values (${owner}, 'calendar')`;
    await rejected(
      tx,
      (db) =>
        db`insert into onboarding_steps (user_id, step_code) values (${owner}, 'calendar')`,
      "23505",
    );
    await tx`insert into onboarding_steps (user_id, step_code) values (${other}, 'calendar'), (${owner}, 'passkey')`;
    await rejected(
      tx,
      (db) =>
        db`insert into onboarding_steps (user_id, step_code) values (${owner}, ' ')`,
      "23514",
      "onboarding_step_code",
    );
  });
});

it("новые личные данные удаляются каскадом с аккаунтом владельца; окна сохраняются", async () => {
  await rollback(async (tx) => {
    const f = await academicContext(tx);
    await tx`insert into passkey_credentials (id, user_id, credential_id, public_key, device_name)
      values (${ids.next()}, ${f.owner}, 'cascade-key', 'test-public-key', 'Учебный телефон')`;
    await tx`insert into webauthn_challenges (id, user_id, purpose, challenge_hash, expires_at)
      values (${ids.next()}, ${f.owner}, 'registration', ${"c".repeat(64)}, now() + interval '5 minutes')`;
    await tx`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
      values (${ids.next()}, ${f.owner}, 'https://push.example.invalid/cascade', 'test-public-key', 'test-auth')`;
    await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
      values (${ids.next()}, ${f.owner}, ${f.request}, ${f.window}, '2035-01-01T06:00:00Z', 'У-001')`;
    await tx`insert into score_events (id, assessment_id, student_id, student_user_id, new_score, changed_by_user_id)
      values (${ids.next()}, ${f.assessment}, ${f.student}, ${f.owner}, 80, ${f.author})`;
    await tx`insert into onboarding_steps (user_id, step_code) values (${f.owner}, 'calendar')`;
    // The pre-M5 student profile has a restrictive FK; isolate new cascade paths.
    await tx`update students set user_id = null where id = ${f.student}`;
    await tx`delete from users where id = ${f.owner}`;
    for (const table of [
      "passkey_credentials",
      "webauthn_challenges",
      "push_subscriptions",
      "pickup_bookings",
      "onboarding_steps",
    ]) {
      expect(
        await tx`select * from ${tx(table)} where user_id = ${f.owner}`,
      ).toHaveLength(0);
    }
    expect(
      await tx`select id from score_events where student_id = ${f.student}`,
    ).toHaveLength(0);
    expect(
      await tx`select id from pickup_windows where id = ${f.window}`,
    ).toHaveLength(1);
    expect(
      await tx`select id from requests where id = ${f.request}`,
    ).toHaveLength(1);
  });
});

it("удаление автора и заявки удаляет связанные события и талоны", async () => {
  await rollback(async (tx) => {
    const f = await academicContext(tx);
    await tx`insert into score_events (id, assessment_id, student_id, new_score, changed_by_user_id)
      values (${ids.next()}, ${f.assessment}, ${f.student}, 80, ${f.author})`;
    await tx`delete from users where id = ${f.author}`;
    expect(
      await tx`select id from score_events where student_id = ${f.student}`,
    ).toHaveLength(0);
    await tx`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no)
      values (${ids.next()}, ${f.owner}, ${f.request}, ${f.window}, '2035-01-01T06:00:00Z', 'У-001')`;
    await tx`delete from requests where id = ${f.request}`;
    expect(
      await tx`select id from pickup_bookings where user_id = ${f.owner}`,
    ).toHaveLength(0);
  });
});

it("уведомление хранит отдельную отметку отправки push после commit", async () => {
  await rollback(async (tx) => {
    const owner = await user(tx);
    const id = ids.next();
    await tx`insert into notifications (id, user_id, kind, title, body, link)
      values (${id}, ${owner}, 'request', 'Справка готова', 'Откройте заявку', '/requests')`;
    const [initial] = await tx<
      { pushed_at: Date | null }[]
    >`select pushed_at from notifications where id = ${id}`;
    expect(initial?.pushed_at).toBeNull();
    await tx`update notifications set pushed_at = '2035-01-01T00:00:00Z' where id = ${id}`;
    const [sent] = await tx<
      { pushed_at: Date }[]
    >`select pushed_at from notifications where id = ${id}`;
    expect(sent?.pushed_at.toISOString()).toBe("2035-01-01T00:00:00.000Z");
  });
});
