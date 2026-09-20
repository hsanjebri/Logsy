import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';

export default async function SignInPage() {
  if (await auth()) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="card flex w-full max-w-sm flex-col gap-6 px-8 py-10">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-ink text-sm font-semibold text-surface"
          >
            L
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em] text-ink">Logsy</span>
        </div>

        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
            Why your CI failed, explained
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Sign in with GitHub to see the repositories Logsy is installed on. Logsy only shows what
            your own GitHub account can already reach.
          </p>
        </div>

        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[10px] bg-ink px-4 py-3 text-sm font-medium text-surface"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
