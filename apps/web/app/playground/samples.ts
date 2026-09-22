/** Short logs in GitHub Actions' format, one per path through the analysis. */
export interface Sample {
  id: string;
  label: string;
  hint: string;
  log: string;
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'vitest',
    label: 'Failing test',
    hint: 'resolved by a rule',
    log: `2026-09-22T09:14:02.1034567Z ##[group]Run pnpm test
2026-09-22T09:14:02.1035123Z pnpm test
2026-09-22T09:14:02.1035678Z shell: /usr/bin/bash -e {0}
2026-09-22T09:14:02.1036012Z ##[endgroup]
2026-09-22T09:14:04.5521004Z > shop@1.4.0 test /home/runner/work/shop/shop
2026-09-22T09:14:04.5521789Z > vitest run
2026-09-22T09:14:06.8810023Z  ✓ src/money.test.ts (12 tests) 18ms
2026-09-22T09:14:06.9120456Z  ❯ src/cart.test.ts (8 tests | 1 failed) 41ms
2026-09-22T09:14:06.9121001Z    × applies the bulk discount per item
2026-09-22T09:14:06.9344002Z  FAIL  src/cart.test.ts > applies the bulk discount per item
2026-09-22T09:14:06.9344567Z AssertionError: expected 90 to be 81 // Object.is equality
2026-09-22T09:14:06.9345012Z  ❯ src/cart.test.ts:42:27
2026-09-22T09:14:06.9345567Z      40|     const cart = createCart([item(50), item(50)]);
2026-09-22T09:14:06.9346001Z      41|     applyBulkDiscount(cart, 0.1);
2026-09-22T09:14:06.9346456Z      42|     expect(cart.total).toBe(81);
2026-09-22T09:14:06.9347001Z  Test Files  1 failed | 1 passed (2)
2026-09-22T09:14:06.9347456Z       Tests  1 failed | 19 passed (20)
2026-09-22T09:14:07.0012345Z  ELIFECYCLE  Test failed. See above for more details.
2026-09-22T09:14:07.0213456Z ##[error]Process completed with exit code 1.`,
  },
  {
    id: 'npm',
    label: 'Dependency conflict',
    hint: 'resolved by a rule',
    log: `2026-09-22T10:02:11.4410001Z ##[group]Run npm ci
2026-09-22T10:02:11.4410567Z npm ci
2026-09-22T10:02:11.4411002Z ##[endgroup]
2026-09-22T10:02:19.7720001Z npm error code ERESOLVE
2026-09-22T10:02:19.7720456Z npm error ERESOLVE could not resolve
2026-09-22T10:02:19.7721001Z npm error
2026-09-22T10:02:19.7721456Z npm error While resolving: @acme/ui@3.2.0
2026-09-22T10:02:19.7722001Z npm error Found: react@19.1.0
2026-09-22T10:02:19.7722456Z npm error node_modules/react
2026-09-22T10:02:19.7723001Z npm error   react@"^19.1.0" from the root project
2026-09-22T10:02:19.7723456Z npm error
2026-09-22T10:02:19.7724001Z npm error Could not resolve dependency:
2026-09-22T10:02:19.7724456Z npm error peer react@"^18.2.0" from react-datepicker@6.9.0
2026-09-22T10:02:19.7725001Z npm error Fix the upstream dependency conflict, or retry
2026-09-22T10:02:19.7725456Z npm error this command with --force or --legacy-peer-deps
2026-09-22T10:02:19.8810001Z ##[error]Process completed with exit code 1.`,
  },
  {
    id: 'deploy',
    label: 'Unusual failure',
    hint: 'goes to the models; contains a fake token to redact',
    log: `2026-09-22T11:30:00.1000001Z ##[group]Run ./scripts/deploy.sh staging
2026-09-22T11:30:00.1000456Z ./scripts/deploy.sh staging
2026-09-22T11:30:00.1001001Z env:
2026-09-22T11:30:00.1001456Z   DEPLOY_TOKEN: ghp_Zq8xR2mN7vK4pL9sT1wY6bH3cJ5dF0gA8eUi
2026-09-22T11:30:00.1002001Z ##[endgroup]
2026-09-22T11:30:02.2000001Z Uploading build artifacts to staging-assets...
2026-09-22T11:30:04.3000001Z Applying database migrations on staging-db-1
2026-09-22T11:30:04.3100001Z migrate: applying 0042_add_order_status.sql
2026-09-22T11:30:04.4000001Z migrate: pq: column "status" of relation "orders" already exists
2026-09-22T11:30:04.4000456Z migrate: rolled back 0042_add_order_status.sql
2026-09-22T11:30:04.4100001Z deploy: migrations failed, keeping the previous release live
2026-09-22T11:30:04.5000001Z ##[error]Process completed with exit code 2.`,
  },
];
