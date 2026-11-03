import { beforeEach, describe, expect, it } from 'vitest';
import { createGroupsRepo } from '../db/groups.js';
import { openDb } from '../db/index.js';
import { applySchema } from '../db/schema.js';
import { CLASSES } from '../domain/classes.js';
import { serializeSlots } from '../domain/templates.js';
import { GROUP_MANAGE_REFUSED_MESSAGE, groupManageRefusal } from './groupManage.js';

let repo: ReturnType<typeof createGroupsRepo>;

beforeEach(() => {
  const db = openDb(':memory:');
  applySchema(db);
  repo = createGroupsRepo(db);
});

const duo = () => {
  const any = { label: 'Any', allowed: CLASSES.map((c) => c.id) };
  const slots = [any, any];
  return repo.create({ guildId: 'g', channelId: 'c', creatorId: 'u1', title: 't', slotsJson: serializeSlots(slots), createdAt: 1 });
};

describe('groupManageRefusal', () => {
  it('allows the creator and Manage Guild members, refuses others and closed groups', () => {
    const group = duo();
    expect(groupManageRefusal(group, 'u1', false)).toBeNull();
    expect(groupManageRefusal(group, 'admin', true)).toBeNull();
    expect(groupManageRefusal(group, 'u2', false)).toBe(GROUP_MANAGE_REFUSED_MESSAGE);
    expect(groupManageRefusal({ ...group, status: 'closed' }, 'u1', true)).toMatch(/geschlossen/);
    expect(groupManageRefusal(undefined, 'u1', true)).toMatch(/existiert nicht mehr/);
  });
});

describe('kickMember', () => {
  it('frees the slot and reopens a full group', () => {
    const group = duo();
    repo.joinMember(group.id, 'u1', 'templar');
    repo.joinMember(group.id, 'u2', 'cleric');
    expect(repo.get(group.id)?.status).toBe('full');
    expect(repo.kickMember(group.id, 'u2')).toMatchObject({ ok: true });
    expect(repo.listMembers(group.id).map((m) => m.userId)).toEqual(['u1']);
    expect(repo.get(group.id)?.status).toBe('open');
  });

  it('refuses the creator, non-members and closed groups', () => {
    const group = duo();
    repo.joinMember(group.id, 'u1', 'templar');
    expect(repo.kickMember(group.id, 'u1')).toEqual({ ok: false, reason: 'creator' });
    expect(repo.kickMember(group.id, 'u9')).toEqual({ ok: false, reason: 'not_member' });
    repo.update(group.id, { status: 'closed' });
    expect(repo.kickMember(group.id, 'u1')).toEqual({ ok: false, reason: 'closed' });
    expect(repo.kickMember(999, 'u1')).toEqual({ ok: false, reason: 'not_found' });
  });
});
