import { describe, expect, it } from 'vitest';
import { createEventsRepo } from '../db/events.js';
import { openDb } from '../db/index.js';
import { applySchema } from '../db/schema.js';
import { MANAGE_REFUSED_MESSAGE, manageRefusal } from './eventManage.js';

function setup() {
  const db = openDb(':memory:');
  applySchema(db);
  return createEventsRepo(db).create({ guildId: 'g', channelId: 'c', creatorId: 'owner', title: 't', startsAt: 2000 });
}

describe('manageRefusal', () => {
  it('allows the creator and members with Manage Guild', () => {
    const event = setup();
    expect(manageRefusal(event, 'owner', false)).toBeNull();
    expect(manageRefusal(event, 'admin', true)).toBeNull();
  });
  it('refuses other members', () => {
    expect(manageRefusal(setup(), 'someone', false)).toBe(MANAGE_REFUSED_MESSAGE);
  });
  it('refuses missing, cancelled and ended events', () => {
    const event = setup();
    expect(manageRefusal(undefined, 'owner', true)).toMatch(/existiert nicht mehr/);
    expect(manageRefusal({ ...event, status: 'cancelled' }, 'owner', true)).toMatch(/abgesagt/);
    expect(manageRefusal({ ...event, status: 'ended' }, 'owner', true)).toMatch(/beendet/);
  });
});
