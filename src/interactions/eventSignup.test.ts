import { describe, expect, it } from 'vitest';
import { createEventsRepo } from '../db/events.js';
import { openDb } from '../db/index.js';
import { applySchema } from '../db/schema.js';
import { saveSignup, signupRefusal } from './eventSignup.js';

function setup() {
  const db = openDb(':memory:');
  applySchema(db);
  const repo = createEventsRepo(db);
  const event = repo.create({ guildId: 'g', channelId: 'c', creatorId: 'o', title: 't', startsAt: 2000 });
  return { repo, event };
}

describe('saveSignup', () => {
  it('inserts, then switches class without duplicating', () => {
    const { repo, event } = setup();
    saveSignup(repo, event.id, 'u', 'templar');
    saveSignup(repo, event.id, 'u', 'cleric');
    expect(repo.listSignups(event.id)).toHaveLength(1);
    expect(repo.getSignup(event.id, 'u')?.classId).toBe('cleric');
  });
});

describe('signupRefusal', () => {
  it('refuses missing, cancelled, ended and started events', () => {
    const { event } = setup();
    expect(signupRefusal(undefined, 1000)).toMatch(/no longer exists/);
    expect(signupRefusal({ ...event, status: 'cancelled' }, 1000)).toMatch(/cancelled/);
    expect(signupRefusal({ ...event, status: 'ended' }, 1000)).toMatch(/started/);
    expect(signupRefusal(event, 2000)).toMatch(/started/);
    expect(signupRefusal(event, 1000)).toBeNull();
  });
});
