ALTER TABLE "assistant_log" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD CONSTRAINT "assistant_log_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_log_session_user_at_idx" ON "assistant_log" USING btree ("session_id","user_id","at");
