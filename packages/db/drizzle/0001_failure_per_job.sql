DROP INDEX "failures_workflow_run_id_index";--> statement-breakpoint
ALTER TABLE "failures" ADD CONSTRAINT "failures_workflowRunId_githubJobId_unique" UNIQUE("workflow_run_id","github_job_id");