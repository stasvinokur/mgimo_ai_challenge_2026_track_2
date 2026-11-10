CREATE TYPE "public"."assessment_kind" AS ENUM('control', 'essay', 'test', 'exam', 'credit');--> statement-breakpoint
CREATE TYPE "public"."exam_kind" AS ENUM('exam', 'credit');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'staff');--> statement-breakpoint
CREATE TYPE "public"."announcement_audience" AS ENUM('all', 'faculty', 'course', 'group');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('change', 'deadline', 'request', 'news', 'alert');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."request_delivery" AS ENUM('pdf', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'accepted', 'in_progress', 'needs_info', 'ready', 'issued', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."change_kind" AS ENUM('moved', 'room', 'cancelled', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."slot_kind" AS ENUM('lecture', 'seminar', 'exam');--> statement-breakpoint
CREATE TYPE "public"."week_parity" AS ENUM('any', 'odd', 'even');--> statement-breakpoint
CREATE TYPE "public"."scholarship" AS ENUM('none', 'academic', 'increased');--> statement-breakpoint
CREATE TABLE "assistant_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"sources" jsonb NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulation_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"doc_slug" text NOT NULL,
	"section" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian'::regconfig, title || ' ' || body)) STORED,
	CONSTRAINT "regulation_chunks_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "regulation_chunks_doc_section_unique" UNIQUE("doc_slug","section")
);
--> statement-breakpoint
CREATE TABLE "staff_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"request_id" uuid NOT NULL,
	"number" text NOT NULL,
	"verify_code" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "certificates_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "certificates_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "certificates_number_unique" UNIQUE("number"),
	CONSTRAINT "certificates_verify_code_unique" UNIQUE("verify_code")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"title" text NOT NULL,
	"weight" integer NOT NULL,
	"max_score" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assessments_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "assessments_weight" CHECK ("assessments"."weight" > 0 and "assessments"."weight" <= 100),
	CONSTRAINT "assessments_max_score" CHECK ("assessments"."max_score" > 0)
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" integer,
	"graded_at" timestamp with time zone,
	CONSTRAINT "scores_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "scores_student_assessment_unique" UNIQUE("student_id","assessment_id"),
	CONSTRAINT "scores_nonnegative" CHECK ("scores"."score" is null or "scores"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions_exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"course_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "exam_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"room_id" uuid NOT NULL,
	CONSTRAINT "sessions_exams_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_sha256" CHECK ("sessions"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "users_login_unique" UNIQUE("login"),
	CONSTRAINT "users_argon2id" CHECK ("users"."password_hash" like '$argon2id$%')
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"audience" "announcement_audience" NOT NULL,
	"audience_ref" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "announcements_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "announcements_audience_ref" CHECK (("announcements"."audience" = 'all' and "announcements"."audience_ref" is null) or ("announcements"."audience" <> 'all' and "announcements"."audience_ref" is not null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"request_id" uuid NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_events_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "request_types" (
	"code" text PRIMARY KEY NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"sla_work_days" integer NOT NULL,
	"delivery" "request_delivery" NOT NULL,
	"fields_schema" jsonb NOT NULL,
	"is_certificate" boolean NOT NULL,
	CONSTRAINT "request_types_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "request_types_sla" CHECK ("request_types"."sla_work_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"public_no" text NOT NULL,
	"student_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"assignee_staff_id" uuid,
	"submitted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "requests_public_no_unique" UNIQUE("public_no")
);
--> statement-breakpoint
CREATE TABLE "calendar_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	CONSTRAINT "calendar_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "calendar_tokens_student_unique" UNIQUE("student_id"),
	CONSTRAINT "calendar_tokens_sha256" CHECK ("calendar_tokens"."token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	CONSTRAINT "courses_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	"building" text NOT NULL,
	CONSTRAINT "rooms_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "rooms_title_unique" UNIQUE("title")
);
--> statement-breakpoint
CREATE TABLE "schedule_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"slot_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "change_kind" NOT NULL,
	"old_starts_at" time,
	"old_ends_at" time,
	"old_room_id" uuid,
	"old_teacher_id" uuid,
	"new_date" date,
	"new_starts_at" time,
	"new_ends_at" time,
	"new_room_id" uuid,
	"new_teacher_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_changes_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "schedule_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"group_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"kind" "slot_kind" NOT NULL,
	"week_parity" "week_parity" DEFAULT 'any' NOT NULL,
	CONSTRAINT "schedule_slots_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "schedule_slots_weekday" CHECK ("schedule_slots"."weekday" between 1 and 7),
	CONSTRAINT "schedule_slots_time" CHECK ("schedule_slots"."ends_at" > "schedule_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"full_name" text NOT NULL,
	CONSTRAINT "teachers_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "faculties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"code" text NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "faculties_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "faculties_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"program_id" uuid NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "groups_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "groups_title_unique" UNIQUE("title")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"faculty_id" uuid NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "programs_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "programs_title_unique" UNIQUE("faculty_id","title")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	CONSTRAINT "staff_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "staff_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_faculties" (
	"staff_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	CONSTRAINT "staff_faculties_staff_id_faculty_id_pk" PRIMARY KEY("staff_id","faculty_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"faculty_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"course" integer NOT NULL,
	"group_id" uuid NOT NULL,
	"record_book_no" text NOT NULL,
	"scholarship" "scholarship" DEFAULT 'none' NOT NULL,
	"target_score" integer DEFAULT 70 NOT NULL,
	CONSTRAINT "students_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "students_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "students_record_book_no_unique" UNIQUE("record_book_no"),
	CONSTRAINT "students_course" CHECK ("students"."course" between 1 and 6),
	CONSTRAINT "students_target" CHECK ("students"."target_score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "assistant_log" ADD CONSTRAINT "assistant_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions_exams" ADD CONSTRAINT "sessions_exams_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions_exams" ADD CONSTRAINT "sessions_exams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions_exams" ADD CONSTRAINT "sessions_exams_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_type_code_request_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."request_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_staff_id_staff_id_fk" FOREIGN KEY ("assignee_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_tokens" ADD CONSTRAINT "calendar_tokens_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_old_room_id_rooms_id_fk" FOREIGN KEY ("old_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_old_teacher_id_teachers_id_fk" FOREIGN KEY ("old_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_new_room_id_rooms_id_fk" FOREIGN KEY ("new_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_changes" ADD CONSTRAINT "schedule_changes_new_teacher_id_teachers_id_fk" FOREIGN KEY ("new_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_faculties" ADD CONSTRAINT "staff_faculties_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_faculties" ADD CONSTRAINT "staff_faculties_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_log_user_at_idx" ON "assistant_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "regulation_chunks_tsv_idx" ON "regulation_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "staff_audit_log_staff_at_idx" ON "staff_audit_log" USING btree ("staff_user_id","at");--> statement-breakpoint
CREATE INDEX "staff_audit_log_request_idx" ON "staff_audit_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "certificates_issued_idx" ON "certificates" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "assessments_group_due_idx" ON "assessments" USING btree ("group_id","due_at");--> statement-breakpoint
CREATE INDEX "assessments_course_group_idx" ON "assessments" USING btree ("course_id","group_id");--> statement-breakpoint
CREATE INDEX "scores_assessment_idx" ON "scores" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "sessions_exams_group_at_idx" ON "sessions_exams" USING btree ("group_id","at");--> statement-breakpoint
CREATE INDEX "login_attempts_key_at_idx" ON "login_attempts" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "login_attempts_at_idx" ON "login_attempts" USING btree ("at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "announcements_audience_idx" ON "announcements" USING btree ("audience","audience_ref","published_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "request_events_request_at_idx" ON "request_events" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "request_events_actor_idx" ON "request_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "requests_student_created_idx" ON "requests" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_status_due_idx" ON "requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "requests_assignee_idx" ON "requests" USING btree ("assignee_staff_id");--> statement-breakpoint
CREATE INDEX "requests_type_idx" ON "requests" USING btree ("type_code");--> statement-breakpoint
CREATE INDEX "schedule_changes_slot_date_idx" ON "schedule_changes" USING btree ("slot_id","date");--> statement-breakpoint
CREATE INDEX "schedule_slots_group_day_idx" ON "schedule_slots" USING btree ("group_id","weekday");--> statement-breakpoint
CREATE INDEX "groups_program_idx" ON "groups" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "programs_faculty_idx" ON "programs" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "staff_faculties_faculty_idx" ON "staff_faculties" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "students_faculty_idx" ON "students" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "students_group_idx" ON "students" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "students_program_idx" ON "students" USING btree ("program_id");