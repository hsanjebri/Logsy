import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { webhookDeliveries } from '../schema.js';

export interface DeliveryInput {
  deliveryId: string;
  event: string;
  action: string | null;
}

export type DeliveryOutcome = 'processed' | 'ignored' | 'failed';

/**
 * Records a delivery and returns true if the caller should process it.
 * Returns false for duplicates, except that a delivery which previously failed
 * can be claimed again (GitHub's "Redeliver" reuses the delivery id).
 */
export async function claimDelivery(db: Executor, input: DeliveryInput): Promise<boolean> {
  const rows = await db
    .insert(webhookDeliveries)
    .values({ ...input, status: 'received' })
    .onConflictDoUpdate({
      target: webhookDeliveries.deliveryId,
      set: { status: 'received', receivedAt: sql`now()`, processedAt: null },
      setWhere: eq(webhookDeliveries.status, 'failed'),
    })
    .returning({ deliveryId: webhookDeliveries.deliveryId });
  return rows.length > 0;
}

export async function completeDelivery(
  db: Executor,
  deliveryId: string,
  status: DeliveryOutcome,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status, processedAt: sql`now()` })
    .where(eq(webhookDeliveries.deliveryId, deliveryId));
}
