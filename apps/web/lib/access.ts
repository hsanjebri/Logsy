import { auth } from '@/auth';
import { findRepositoryByFullName } from '@logsy/db';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from './db';

/**
 * Authorization is delegated to GitHub: a viewer sees exactly the repositories their
 * own token can reach through a Logsy installation. Nothing is stored here, so
 * revoking access on GitHub takes effect immediately.
 */

const installationsSchema = z.object({
  installations: z.array(z.object({ id: z.number().int().positive() })),
});

const repositoriesSchema = z.object({
  repositories: z.array(z.object({ id: z.number().int().positive(), full_name: z.string() })),
});

export interface Viewer {
  name: string;
  login: string;
  image: string | null;
  accessToken: string;
}

/** The signed-in viewer, or a redirect to the sign-in page. */
export async function requireViewer(): Promise<Viewer> {
  const session = await auth();
  if (!session?.accessToken) redirect('/signin');

  return {
    name: session.user?.name ?? 'You',
    login: session.user?.email ?? session.user?.name ?? 'viewer',
    image: session.user?.image ?? null,
    accessToken: session.accessToken,
  };
}

async function github<T>(path: string, token: string, schema: z.ZodType<T>): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    // Access changes must show up quickly, but not on every render.
    next: { revalidate: 60 },
  });
  if (!response.ok) return null;
  const parsed = schema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

/** GitHub repository ids this viewer can see through their Logsy installations. */
export async function viewerRepoIds(token: string): Promise<number[]> {
  const installations = await github(
    '/user/installations?per_page=100',
    token,
    installationsSchema,
  );
  if (!installations) return [];

  const ids: number[] = [];
  for (const installation of installations.installations) {
    const repos = await github(
      `/user/installations/${String(installation.id)}/repositories?per_page=100`,
      token,
      repositoriesSchema,
    );
    for (const repo of repos?.repositories ?? []) ids.push(repo.id);
  }
  return ids;
}

/**
 * A repository by name, but only if this viewer may see it. Anything else is a 404,
 * which never reveals whether the repository exists.
 */
export async function requireRepository(fullName: string, token: string) {
  const repository = await findRepositoryByFullName(db, fullName);
  if (!repository) return null;

  const allowed = await viewerRepoIds(token);
  return allowed.includes(repository.githubRepoId) ? repository : null;
}
