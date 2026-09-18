import { z } from 'zod';

// Only the fields Logsy uses are declared; Zod strips everything else.

const accountSchema = z
  .object({
    login: z.string().optional(),
    // Enterprise accounts have a slug instead of a login and no type.
    slug: z.string().optional(),
    type: z.string().optional(),
  })
  .nullable();

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: accountSchema,
  suspended_at: z.string().nullable().optional(),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  private: z.boolean(),
});

export const installationEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories: z.array(repositorySchema).optional(),
});

export const installationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories_added: z.array(repositorySchema),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })),
});

export const workflowRunEventSchema = z.object({
  action: z.string(),
  workflow_run: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive().default(1),
    name: z.string().nullable(),
    head_sha: z.string().min(1),
    head_branch: z.string().nullable(),
    event: z.string().min(1),
    conclusion: z.string().nullable(),
    html_url: z.url(),
    pull_requests: z.array(z.object({ number: z.number().int().positive() })).nullable(),
  }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string().min(1),
    private: z.boolean(),
    owner: z.object({ login: z.string().min(1), type: z.string().optional() }),
  }),
  // Present on every GitHub App delivery, but treated as optional for safety.
  installation: z.object({ id: z.number().int().positive() }).optional(),
});

export type WorkflowRunEvent = z.infer<typeof workflowRunEventSchema>;
export type InstallationPayload = z.infer<typeof installationSchema>;
export type RepositoryPayload = z.infer<typeof repositorySchema>;
export type InstallationEvent = z.infer<typeof installationEventSchema>;
export type InstallationRepositoriesEvent = z.infer<typeof installationRepositoriesEventSchema>;

/** Best-effort `action` for bookkeeping, before the payload is validated per event. */
export function readAction(payload: unknown): string | null {
  const result = z.object({ action: z.string() }).safeParse(payload);
  return result.success ? result.data.action : null;
}
