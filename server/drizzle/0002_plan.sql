CREATE TYPE "public"."goal_status" AS ENUM('active', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."plan_phase" AS ENUM('base', 'build', 'peak', 'taper');--> statement-breakpoint
CREATE TYPE "public"."race_distance" AS ENUM('5k', '10k', 'half', 'marathon');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('easy', 'long', 'tempo', 'intervals', 'race', 'rest');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'done', 'missed');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('pending', 'scheduled', 'no_slot');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"race_distance" "race_distance" NOT NULL,
	"race_date" date NOT NULL,
	"time_windows" jsonb NOT NULL,
	"long_run_weekday" integer NOT NULL,
	"start_day" date NOT NULL,
	"weeks" jsonb NOT NULL,
	"baseline" jsonb,
	"calendar_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"decided_on" date NOT NULL,
	"rule_id" text NOT NULL,
	"kind" "session_kind" NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"day" date NOT NULL,
	"week_index" integer NOT NULL,
	"phase" "plan_phase" NOT NULL,
	"base_kind" "session_kind" NOT NULL,
	"base_minutes" integer NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"activity_id" text,
	"actual_minutes" integer,
	"slot_status" "slot_status" DEFAULT 'pending' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"calendar_event_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_session_id_planned_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goals_user_id_index" ON "goals" USING btree ("user_id") WHERE "goals"."status" = 'active';--> statement-breakpoint
CREATE INDEX "plan_adjustments_user_id_decided_on_index" ON "plan_adjustments" USING btree ("user_id","decided_on");--> statement-breakpoint
CREATE INDEX "plan_adjustments_session_id_index" ON "plan_adjustments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "planned_sessions_user_id_day_index" ON "planned_sessions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "planned_sessions_goal_id_index" ON "planned_sessions" USING btree ("goal_id");