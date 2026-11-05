import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { joinableClassIds } from '../domain/groups.js';
import { parseTemplateText, serializeSlots, type TemplateSlot } from '../domain/templates.js';
import { createGroupsRepo } from './groups.js';
import { openDb } from './index.js';
import { applySchema } from './schema.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  applySchema(db);
});

const TEMPLATE_TEXT: Record<string, string> = {
  'Duo (2)': 'Any: any\nAny: any',
  'Open (5)': 'Any: any\n'.repeat(5),
  'Dungeon (5)': 'Tank: tank\nHealer: healer\nDPS: dps\nDPS: dps\nAny: any',
};
const template = (name: string) => ({ slots: (parseTemplateText(TEMPLATE_TEXT[name]!) as { value: TemplateSlot[] }).value });
const newGroup = (name: string, creatorId = 'u1') => {
  const t = template(name);
  const repo = createGroupsRepo(db);
  const group = repo.create({ guildId: 'g', channelId: 'c', creatorId, title: 't', slotsJson: serializeSlots(t.slots), createdAt: 1 });
  return { repo, group, slots: t.slots };
};

describe('joinMember', () => {
  it('places members in matching slots and fills the group', () => {
    const { repo, group } = newGroup('Duo (2)');
    const first = repo.joinMember(group.id, 'u1', 'templar');
    expect(first).toMatchObject({ ok: true, slotIndex: 0, switched: false, becameFull: false });
    const second = repo.joinMember(group.id, 'u2', 'cleric');
    expect(second).toMatchObject({ ok: true, slotIndex: 1, becameFull: true });
    expect(repo.get(group.id)?.status).toBe('full');
    expect(repo.joinMember(group.id, 'u3', 'ranger')).toEqual({ ok: false, reason: 'no_slot' });
  });

  it('lets a member switch class into a fitting slot', () => {
    const { repo, group } = newGroup('Dungeon (5)');
    repo.joinMember(group.id, 'u1', 'templar'); // Tank
    repo.joinMember(group.id, 'u2', 'cleric'); // Healer
    const sw = repo.joinMember(group.id, 'u2', 'ranger');
    expect(sw).toMatchObject({ ok: true, switched: true, becameFull: false });
    expect(repo.getMember(group.id, 'u2')).toMatchObject({ classId: 'ranger' });
    repo.joinMember(group.id, 'u3', 'ranger');
    repo.joinMember(group.id, 'u4', 'ranger');
    repo.joinMember(group.id, 'u5', 'ranger');
    const before = repo.getMember(group.id, 'u1')!;
    expect(repo.joinMember(group.id, 'u1', 'cleric')).toMatchObject({ ok: true }); // healer slot free
    expect(repo.getMember(group.id, 'u1')!.slotIndex).not.toBe(before.slotIndex);
  });

  it('lets a second tank take the Any slot and refuses joins to a full group', () => {
    const { repo, group } = newGroup('Dungeon (5)');
    repo.joinMember(group.id, 'u1', 'templar');
    repo.joinMember(group.id, 'u2', 'gladiator'); // other tank goes to "Any"
    const result = repo.joinMember(group.id, 'u2', 'templar');
    expect(result).toMatchObject({ ok: true });
    const full = newGroup('Duo (2)');
    full.repo.joinMember(full.group.id, 'a', 'templar');
    full.repo.joinMember(full.group.id, 'b', 'templar');
    expect(full.repo.joinMember(full.group.id, 'c', 'cleric')).toEqual({ ok: false, reason: 'no_slot' });
    expect(full.repo.listMembers(full.group.id)).toHaveLength(2);
  });

  it('refuses a second last-slot pick: exactly one of two joiners wins', () => {
    const { repo, group } = newGroup('Duo (2)');
    repo.joinMember(group.id, 'u1', 'templar');
    const a = repo.joinMember(group.id, 'u2', 'cleric');
    const b = repo.joinMember(group.id, 'u3', 'cleric');
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(repo.listMembers(group.id)).toHaveLength(2);
  });

  it('rejects closed and unknown groups', () => {
    const { repo, group } = newGroup('Duo (2)');
    repo.update(group.id, { status: 'closed' });
    expect(repo.joinMember(group.id, 'u1', 'templar')).toEqual({ ok: false, reason: 'closed' });
    expect(repo.joinMember(999, 'u1', 'templar')).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('leaveMember', () => {
  it('frees the slot and reopens a full group', () => {
    const { repo, group } = newGroup('Duo (2)');
    repo.joinMember(group.id, 'u1', 'templar');
    repo.joinMember(group.id, 'u2', 'cleric');
    expect(repo.get(group.id)?.status).toBe('full');
    const left = repo.leaveMember(group.id, 'u2');
    expect(left).toMatchObject({ ok: true, newCreatorId: null });
    expect(repo.get(group.id)?.status).toBe('open');
    expect(repo.listMembers(group.id)).toHaveLength(1);
  });

  it('hands the group to the earliest remaining member when the creator leaves', () => {
    const { repo, group } = newGroup('Open (5)');
    repo.addMember(group.id, 'u1', 'templar', 0, 10);
    repo.addMember(group.id, 'u3', 'cleric', 1, 30);
    repo.addMember(group.id, 'u2', 'ranger', 2, 20);
    const left = repo.leaveMember(group.id, 'u1');
    expect(left).toMatchObject({ ok: true, newCreatorId: 'u2' });
    expect(repo.get(group.id)?.creatorId).toBe('u2');
  });

  it('closes the group when the last member leaves', () => {
    const { repo, group } = newGroup('Duo (2)');
    repo.joinMember(group.id, 'u1', 'templar');
    expect(repo.leaveMember(group.id, 'u1')).toMatchObject({ ok: true, newCreatorId: null });
    expect(repo.get(group.id)?.status).toBe('closed');
  });

  it('keeps an event open with its organizer when members leave', () => {
    const repo = createGroupsRepo(db);
    const slots = template('Duo (2)').slots;
    const event = repo.create({ guildId: 'g', channelId: 'c', creatorId: 'org', title: 't', slotsJson: serializeSlots(slots), kind: 'event', createdAt: 1 });
    repo.joinMember(event.id, 'u1', 'templar');
    expect(repo.leaveMember(event.id, 'u1')).toMatchObject({ ok: true, newCreatorId: null });
    expect(repo.get(event.id)).toMatchObject({ status: 'open', creatorId: 'org' });
  });

  it('reports non-members, closed and unknown groups', () => {
    const { repo, group } = newGroup('Duo (2)');
    expect(repo.leaveMember(group.id, 'x')).toEqual({ ok: false, reason: 'not_member' });
    expect(repo.leaveMember(999, 'x')).toEqual({ ok: false, reason: 'not_found' });
    repo.update(group.id, { status: 'closed' });
    expect(repo.leaveMember(group.id, 'x')).toEqual({ ok: false, reason: 'closed' });
  });
});

describe('joinableClassIds', () => {
  it('offers only classes that fit a free slot and counts the own slot as free', () => {
    const { slots } = newGroup('Dungeon (5)');
    const tank = [{ userId: 'u1', classId: 'templar', slotIndex: 0 }];
    const ids = joinableClassIds(slots, tank, 'u2');
    expect(ids).toContain('templar'); // fits "Any"
    const all = [0, 1, 2, 3, 4].map((slotIndex) => ({ userId: `u${slotIndex}`, classId: 'templar', slotIndex }));
    expect(joinableClassIds(slots, all, 'other')).toEqual([]);
    expect(joinableClassIds(slots, all, 'u1').length).toBeGreaterThan(0);
  });
});
