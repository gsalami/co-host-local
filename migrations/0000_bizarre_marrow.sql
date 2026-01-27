CREATE TABLE IF NOT EXISTS "pronunciation_vocab" (
        "id" serial PRIMARY KEY NOT NULL,
        "word" text NOT NULL,
        "language" text DEFAULT 'en' NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shows" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" text NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" text NOT NULL,
        "type" text NOT NULL,
        "mime_type" text NOT NULL,
        "original_filename" text NOT NULL,
        "text_content" text NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speaker_mappings" (
        "id" serial PRIMARY KEY NOT NULL,
        "show_id" integer NOT NULL,
        "speaker_index" integer NOT NULL,
        "display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_prompts" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "prompt" text NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transcript_segments" (
        "id" serial PRIMARY KEY NOT NULL,
        "show_id" integer,
        "text" text NOT NULL,
        "speaker" integer,
        "timestamp" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "metadata" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" varchar PRIMARY KEY NOT NULL,
        "sess" jsonb NOT NULL,
        "expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "email" varchar,
        "first_name" varchar,
        "last_name" varchar,
        "profile_image_url" varchar,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "speaker_mappings" ADD CONSTRAINT "speaker_mappings_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");