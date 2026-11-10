CREATE TYPE "public"."webauthn_challenge_purpose" AS ENUM('registration', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."pickup_booking_status" AS ENUM('booked', 'called', 'served', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"student_user_id" uuid,
	"previous_score" integer,
	"new_score" integer NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_events_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "score_events_reason_length" CHECK (char_length("score_events"."reason") <= 300),
	CONSTRAINT "score_events_change_reason" CHECK ("score_events"."previous_score" is null or ("score_events"."reason" is not null and length(trim("score_events"."reason")) > 0)),
	CONSTRAINT "score_events_nonnegative" CHECK ("score_events"."new_score" >= 0 and ("score_events"."previous_score" is null or "score_events"."previous_score" >= 0))
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "passkey_counter_range" CHECK ("passkey_credentials"."counter" between 0 and 4294967295),
	CONSTRAINT "passkey_credential_id" CHECK (length("passkey_credentials"."credential_id") > 0),
	CONSTRAINT "passkey_public_key" CHECK (length("passkey_credentials"."public_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"purpose" "webauthn_challenge_purpose" NOT NULL,
	"challenge_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "webauthn_challenges_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "webauthn_challenges_sha256" CHECK ("webauthn_challenges"."challenge_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "webauthn_challenges_lifetime" CHECK ("webauthn_challenges"."expires_at" > "webauthn_challenges"."created_at"),
	CONSTRAINT "webauthn_challenges_max_lifetime" CHECK ("webauthn_challenges"."expires_at" <= "webauthn_challenges"."created_at" + interval '5 minutes'),
	CONSTRAINT "webauthn_registration_user" CHECK ("webauthn_challenges"."purpose" <> 'registration' or "webauthn_challenges"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_endpoint_https" CHECK ("push_subscriptions"."endpoint" ~ '^https://[^/[:space:]]+'),
	CONSTRAINT "push_failures_nonnegative" CHECK ("push_subscriptions"."failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"user_id" uuid NOT NULL,
	"step_code" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_steps_user_id_step_code_pk" PRIMARY KEY("user_id","step_code"),
	CONSTRAINT "onboarding_step_code" CHECK (length(trim("onboarding_steps"."step_code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pickup_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"slot_starts_at" timestamp with time zone NOT NULL,
	"ticket_no" text NOT NULL,
	"status" "pickup_booking_status" DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_bookings_ten_minute_slot" CHECK (mod(extract(epoch from "pickup_bookings"."slot_starts_at"), 600) = 0),
	CONSTRAINT "pickup_bookings_ticket" CHECK (length(trim("pickup_bookings"."ticket_no")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pickup_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"faculty_id" uuid NOT NULL,
	"title" text NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "pickup_windows_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "pickup_windows_hours" CHECK ("pickup_windows"."closes_at" > "pickup_windows"."opens_at")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_bookings" ADD CONSTRAINT "pickup_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_bookings" ADD CONSTRAINT "pickup_bookings_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_bookings" ADD CONSTRAINT "pickup_bookings_window_id_pickup_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."pickup_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_windows" ADD CONSTRAINT "pickup_windows_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_events_student_created_idx" ON "score_events" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "score_events_assessment_idx" ON "score_events" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "score_events_author_idx" ON "score_events" USING btree ("changed_by_user_id");--> statement-breakpoint
CREATE INDEX "score_events_user_idx" ON "score_events" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_user_idx" ON "webauthn_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expiry_idx" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pickup_bookings_user_idx" ON "pickup_bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pickup_bookings_window_day_idx" ON "pickup_bookings" USING btree ("window_id","slot_starts_at");--> statement-breakpoint
CREATE INDEX "pickup_bookings_request_idx" ON "pickup_bookings" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_bookings_active_slot_unique" ON "pickup_bookings" USING btree ("window_id","slot_starts_at") WHERE "pickup_bookings"."status" in ('booked', 'called');--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_bookings_active_request_unique" ON "pickup_bookings" USING btree ("request_id") WHERE "pickup_bookings"."status" in ('booked', 'called');--> statement-breakpoint
CREATE INDEX "pickup_windows_faculty_idx" ON "pickup_windows" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "notifications_push_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."pushed_at" is null;