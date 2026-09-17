CREATE TYPE "public"."analysis_source" AS ENUM('rule', 'llm', 'cache');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."failure_category" AS ENUM('test_failure', 'build_error', 'type_error', 'lint_error', 'dependency_error', 'infrastructure', 'timeout', 'out_of_memory', 'configuration', 'flaky', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('helpful', 'wrong');--> statement-breakpoint
CREATE TYPE "public"."flaky_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analyses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"failure_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"source" "analysis_source" NOT NULL,
	"rule_id" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"result" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failures" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_run_id" integer NOT NULL,
	"github_job_id" bigint NOT NULL,
	"job_name" text NOT NULL,
	"step_name" text,
	"category" "failure_category" DEFAULT 'unknown' NOT NULL,
	"fingerprint" text NOT NULL,
	"error_excerpt" text NOT NULL,
	"log_chars_original" integer NOT NULL,
	"log_chars_trimmed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"analysis_id" integer NOT NULL,
	"github_user" text NOT NULL,
	"verdict" "feedback_verdict" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_analysisId_githubUser_unique" UNIQUE("analysis_id","github_user")
);
--> statement-breakpoint
CREATE TABLE "flaky_tests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "flaky_tests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"suite" text NOT NULL,
	"test_name" text NOT NULL,
	"flip_count" integer DEFAULT 0 NOT NULL,
	"last_flipped_at" timestamp with time zone,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "flaky_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "flaky_tests_repositoryId_suite_testName_unique" UNIQUE("repository_id","suite","test_name")
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "installations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"github_installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "installations_githubInstallationId_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "pr_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pr_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"pr_number" integer NOT NULL,
	"github_comment_id" bigint NOT NULL,
	"last_run_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_comments_repositoryId_prNumber_unique" UNIQUE("repository_id","pr_number")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repositories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"installation_id" integer NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"settings" jsonb DEFAULT '{"enabled":true,"commentMode":"single","llmEnabled":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_githubRepoId_unique" UNIQUE("github_repo_id")
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"workflow_run_id" integer NOT NULL,
	"head_sha" text NOT NULL,
	"suite" text NOT NULL,
	"test_name" text NOT NULL,
	"status" "test_status" NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "delivery_status" DEFAULT 'received' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"github_run_id" bigint NOT NULL,
	"run_attempt" integer NOT NULL,
	"workflow_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"head_branch" text,
	"event" text NOT NULL,
	"conclusion" text,
	"pr_number" integer,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_githubRunId_runAttempt_unique" UNIQUE("github_run_id","run_attempt")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_failure_id_failures_id_fk" FOREIGN KEY ("failure_id") REFERENCES "public"."failures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flaky_tests" ADD CONSTRAINT "flaky_tests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_comments" ADD CONSTRAINT "pr_comments_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_comments" ADD CONSTRAINT "pr_comments_last_run_id_workflow_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_failure_id_index" ON "analyses" USING btree ("failure_id");--> statement-breakpoint
CREATE INDEX "analyses_fingerprint_created_at_index" ON "analyses" USING btree ("fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "failures_workflow_run_id_index" ON "failures" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "failures_fingerprint_index" ON "failures" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "repositories_installation_id_index" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "repositories_full_name_index" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "test_results_repository_id_suite_test_name_created_at_index" ON "test_results" USING btree ("repository_id","suite","test_name","created_at");--> statement-breakpoint
CREATE INDEX "test_results_repository_id_head_sha_index" ON "test_results" USING btree ("repository_id","head_sha");--> statement-breakpoint
CREATE INDEX "test_results_workflow_run_id_index" ON "test_results" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_at_index" ON "webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_repository_id_created_at_index" ON "workflow_runs" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_repository_id_head_sha_index" ON "workflow_runs" USING btree ("repository_id","head_sha");