CREATE TYPE "public"."attendance_source" AS ENUM('qr', 'excuse', 'demo');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'excused', 'absent');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'teacher';--> statement-breakpoint
CREATE TABLE "activity_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"student_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_points_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "activity_student_source_unique" UNIQUE("student_id","source_key"),
	CONSTRAINT "activity_points_positive" CHECK ("activity_points"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"teacher_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "attendance_codes_sha256" CHECK ("attendance_codes"."code_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "attendance_codes_lifetime" CHECK ("attendance_codes"."expires_at" > "attendance_codes"."created_at"),
	CONSTRAINT "attendance_codes_max_lifetime" CHECK ("attendance_codes"."expires_at" <= "attendance_codes"."created_at" + interval '2 minutes')
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed_key" text,
	"student_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"source" "attendance_source" NOT NULL,
	"source_key" text NOT NULL,
	"reason" text,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_seed_key_unique" UNIQUE("seed_key"),
	CONSTRAINT "attendance_student_lesson_unique" UNIQUE("student_id","slot_id","occurrence_date"),
	CONSTRAINT "attendance_excused_reason" CHECK ("attendance_records"."status" <> 'excused' or length(trim("attendance_records"."reason")) > 0 and "attendance_records"."reason" is not null),
	CONSTRAINT "attendance_reason_length" CHECK (char_length("attendance_records"."reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_points" ADD CONSTRAINT "activity_points_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_codes" ADD CONSTRAINT "attendance_codes_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_codes" ADD CONSTRAINT "attendance_codes_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_codes_lesson_idx" ON "attendance_codes" USING btree ("slot_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "attendance_codes_expiry_idx" ON "attendance_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "attendance_lesson_idx" ON "attendance_records" USING btree ("slot_id","occurrence_date");--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_unique" UNIQUE("user_id");