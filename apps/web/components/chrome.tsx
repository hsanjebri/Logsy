import Link from 'next/link';
import type { ReactNode } from 'react';

/** The shell: a light rail and a hairline top bar, as in the design preview. */

export function Rail({
  active,
  repoFullName,
  viewer,
}: {
  active: 'overview' | 'runs' | 'recurring' | 'flaky' | 'settings' | 'repos';
  repoFullName?: string;
  viewer: { name: string; image: string | null };
}) {
  const base = repoFullName ? `/repos/${repoFullName}` : null;
  const items: { key: typeof active; label: string; href: string }[] = base
    ? [
        { key: 'overview', label: 'Overview', href: base },
        { key: 'runs', label: 'Runs', href: `${base}/runs` },
        { key: 'flaky', label: 'Flaky tests', href: `${base}/flaky` },
        { key: 'settings', label: 'Settings', href: `${base}/settings` },
      ]
    : [{ key: 'repos', label: 'Repositories', href: '/' }];

  return (
    <nav
      aria-label="Main"
      className="flex w-[252px] shrink-0 flex-col gap-8 border-r border-hairline p-6"
    >
      <Link href="/" className="flex items-center gap-2.5 px-2 no-underline">
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-ink text-[13px] font-semibold text-surface"
        >
          L
        </span>
        <span className="text-base font-semibold tracking-[-0.02em] text-ink">Logsy</span>
      </Link>

      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === active ? 'page' : undefined}
            className={
              item.key === active
                ? 'card flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-sm font-medium text-ink no-underline'
                : 'flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-sm text-secondary no-underline hover:text-ink'
            }
          >
            <span
              aria-hidden="true"
              className={
                item.key === active
                  ? 'h-1.5 w-1.5 rounded-full bg-ink'
                  : 'h-1.5 w-1.5 rounded-full bg-hairline'
              }
            />
            {item.label}
          </Link>
        ))}
      </div>

      {repoFullName ? (
        <Link href="/" className="px-2.5 text-[13px] text-secondary no-underline hover:text-ink">
          ← All repositories
        </Link>
      ) : null}

      <div className="mt-auto flex items-center gap-2.5 rounded-[10px] bg-track px-2.5 py-2">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full bg-ink text-[11px] font-semibold text-surface"
        >
          {viewer.image ? (
            <img src={viewer.image} alt="" className="h-full w-full object-cover" />
          ) : (
            viewer.name.slice(0, 2).toUpperCase()
          )}
        </span>
        <span className="truncate text-[13px] font-medium text-ink">{viewer.name}</span>
      </div>
    </nav>
  );
}

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-[66px] shrink-0 items-center gap-4 border-b border-hairline px-8">
      {children}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen bg-canvas">{children}</div>;
}

export function Content({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-8 py-16 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="max-w-md text-sm text-secondary">{hint}</p>
    </div>
  );
}
