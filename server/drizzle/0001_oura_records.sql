CREATE TABLE "oura_records" (
	"user_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"record_id" text NOT NULL,
	"day" date,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oura_records_user_id_collection_record_id_pk" PRIMARY KEY("user_id","collection","record_id")
);
--> statement-breakpoint
ALTER TABLE "oura_records" ADD CONSTRAINT "oura_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oura_records_user_id_day_index" ON "oura_records" USING btree ("user_id","day");