import type { Sql } from "postgres";
import type {
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/application/onboarding/ports";
import type { StoredStepCode } from "@/domain/onboarding/steps";

export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly database: () => Sql) {}

  async findForUser(userId: string): Promise<OnboardingSnapshot | null> {
    const [row] = await this.database()<
      {
        course: number;
        completedCodes: string[];
        calendar: boolean;
        assistant: boolean;
        push: boolean;
        passkey: boolean;
      }[]
    >`select s.course,
      array(select os.step_code from onboarding_steps os where os.user_id = ${userId}) as "completedCodes",
      exists(select 1 from calendar_tokens ct where ct.student_id = s.id) as calendar,
      exists(select 1 from assistant_log al where al.user_id = ${userId}) as assistant,
      exists(select 1 from push_subscriptions ps where ps.user_id = ${userId}) as push,
      exists(select 1 from passkey_credentials pc where pc.user_id = ${userId}) as passkey
      from students s where s.user_id = ${userId}`;
    if (!row) return null;
    return {
      course: row.course,
      completedCodes: row.completedCodes,
      automatic: {
        calendar: row.calendar,
        assistant: row.assistant,
        push: row.push,
        passkey: row.passkey,
      },
    };
  }

  async completeForUser(
    userId: string,
    codes: readonly StoredStepCode[],
    completedAt: string,
  ): Promise<void> {
    if (!codes.length) return;
    const sql = this.database();
    await sql`insert into onboarding_steps (user_id, step_code, completed_at)
      select ${userId}, step.code, ${completedAt}::timestamptz
      from unnest(${[...codes]}::text[]) as step(code)
      on conflict (user_id, step_code) do nothing`;
  }
}
