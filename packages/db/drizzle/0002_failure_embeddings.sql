-- Semantic recall: find an older failure that means the same thing, even when the
-- wording differs. Needs pgvector, which the compose image (pgvector/pgvector:pg16)
-- and most managed Postgres services provide.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "failure_embeddings" (
	"failure_id" integer PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "failure_embeddings" ADD CONSTRAINT "failure_embeddings_failure_id_failures_id_fk" FOREIGN KEY ("failure_id") REFERENCES "public"."failures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_embeddings" ADD CONSTRAINT "failure_embeddings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failure_embeddings_repository_id_index" ON "failure_embeddings" USING btree ("repository_id");--> statement-breakpoint
-- Cosine distance is what the query orders by; the list count suits a few thousand rows.
CREATE INDEX "failure_embeddings_embedding_index" ON "failure_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
