'use server';

import { requireRepository, requireViewer } from '@/lib/access';
import { db } from '@/lib/db';
import { updateRepositorySettings } from '@logsy/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const settingsSchema = z.object({
  fullName: z.string().min(3),
  enabled: z.coerce.boolean(),
  llmEnabled: z.coerce.boolean(),
  commentMode: z.enum(['single', 'off']),
});

/** Saves a repository's settings, after checking the viewer may change them. */
export async function saveSettings(formData: FormData): Promise<void> {
  const parsed = settingsSchema.parse({
    fullName: formData.get('fullName'),
    enabled: formData.get('enabled') === 'on',
    llmEnabled: formData.get('llmEnabled') === 'on',
    commentMode: formData.get('commentMode') ?? 'single',
  });

  const viewer = await requireViewer();
  const repository = await requireRepository(parsed.fullName, viewer.accessToken);
  if (!repository) throw new Error('Repository not found');

  await updateRepositorySettings(db, repository.id, {
    enabled: parsed.enabled,
    llmEnabled: parsed.llmEnabled,
    commentMode: parsed.commentMode,
  });

  revalidatePath(`/repos/${parsed.fullName}/settings`);
}
