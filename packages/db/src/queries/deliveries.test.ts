import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.js';
import { webhookDeliveries } from '../schema.js';
import { truncateAll } from '../testing.js';
import { claimDelivery, completeDelivery } from './deliveries.js';

const { db, pool } = createDatabase(inject('databaseUrl'));

afterAll(() => pool.end());
beforeEach(() => truncateAll(db));

const delivery = { deliveryId: 'd-1', event: 'installation', action: 'created' };

describe('webhook deliveries', () => {
  it('claims a new delivery once', async () => {
    expect(await claimDelivery(db, delivery)).toBe(true);
    expect(await claimDelivery(db, delivery)).toBe(false);

    const [row] = await db.select().from(webhookDeliveries);
    expect(row?.status).toBe('received');
    expect(row?.processedAt).toBeNull();
  });

  it('does not reclaim processed or ignored deliveries', async () => {
    await claimDelivery(db, delivery);
    await completeDelivery(db, delivery.deliveryId, 'processed');
    expect(await claimDelivery(db, delivery)).toBe(false);

    await claimDelivery(db, { ...delivery, deliveryId: 'd-2' });
    await completeDelivery(db, 'd-2', 'ignored');
    expect(await claimDelivery(db, { ...delivery, deliveryId: 'd-2' })).toBe(false);
  });

  it('allows a failed delivery to be retried', async () => {
    await claimDelivery(db, delivery);
    await completeDelivery(db, delivery.deliveryId, 'failed');

    expect(await claimDelivery(db, delivery)).toBe(true);
    const [row] = await db.select().from(webhookDeliveries);
    expect(row?.status).toBe('received');
    expect(row?.processedAt).toBeNull();
  });

  it('records the processing time on completion', async () => {
    await claimDelivery(db, delivery);
    await completeDelivery(db, delivery.deliveryId, 'processed');

    const [row] = await db.select().from(webhookDeliveries);
    expect(row?.status).toBe('processed');
    expect(row?.processedAt).toBeInstanceOf(Date);
  });
});
