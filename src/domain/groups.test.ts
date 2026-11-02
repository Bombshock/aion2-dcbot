import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createGroupsRepo } from '../db/groups.js';
import { openDb } from '../db/index.js';
import { applySchema } from '../db/schema.js';
import {
  buildFooter,
  buildGroupEmbed,
  buildSlotLines,
  checkCreateGroup,
  MAX_ACTIVE_GROUPS_PER_CREATOR,
  statusForFill,
  type GroupView,
} from './groups.js';
import { BUILTIN_TEMPLATES, serializeSlots } from './templates.js';

const dungeon = BUILTIN_TEMPLATES.find((t) => t.name === 'Dungeon (5)')!.slots;

describe('buildSlotLines', () => {
  it('shows taken, open and any-class slots', () => {
    const lines = buildSlotLines(dungeon, [{ userId: '1', classId: 'templar', slotIndex: 0 }]);
    expect(lines[0]).toBe('1. Tank 🛡️ <@1> (Templar)');
    expect(lines[1]).toBe('2. Healer — open (Cleric)');
    expect(lines[2]).toBe('3. DPS — open (Assassin, Ranger, Sorcerer, Spiritmaster)');
    expect(lines[4]).toBe('5. Any — open (any class)');
  });
});

describe('buildFooter', () => {
  it('reports open and full groups', () => {
    const one = [{ userId: '1', classId: 'templar', slotIndex: 0 }];
    expect(buildFooter(dungeon, one, 'open')).toBe('1/5 · open');
    const all = dungeon.map((_, i) => ({ userId: String(i), classId: 'templar', slotIndex: i }));
    expect(buildFooter(dungeon, all, 'full')).toBe('5/5 · full ✅');
  });
});

describe('statusForFill', () => {
  it('is full when every slot is taken', () => {
    const solo = [{ label: 'Any', allowed: ['templar'] }];
    expect(statusForFill(solo, [{}])).toBe('full');
    expect(statusForFill(dungeon, [{}])).toBe('open');
  });
});

describe('buildGroupEmbed', () => {
  const group: GroupView = { id: 1, creatorId: '1', title: 'Run', description: 'Go', startsAt: null, status: 'open', slots: dungeon };
  it('says Now without a time and uses timestamps with one', () => {
    expect(buildGroupEmbed(group, []).fields[0].value).toBe('Now');
    expect(buildGroupEmbed({ ...group, startsAt: 100 }, []).fields[0].value).toBe('<t:100:F> (<t:100:R>)');
  });
});

describe('checkCreateGroup', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDb(':memory:');
    applySchema(db);
  });

  it('puts a Cleric into Healer, not Any', () => {
    expect(checkCreateGroup(dungeon, 'cleric', 0)).toEqual({ ok: true, value: 1 });
  });

  it('lists fitting classes when the class fits no slot', () => {
    const r = checkCreateGroup([{ label: 'Tank', allowed: ['templar', 'gladiator'] }], 'cleric', 0);
    expect(r).toEqual({ ok: false, message: 'Your class fits no slot in this template. Fitting classes: Gladiator, Templar' });
  });

  it('refuses a 4th open group; closed groups do not count', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 't', slotsJson: serializeSlots(dungeon) };
    const groups = [0, 1, 2].map(() => repo.create(base));
    expect(repo.countActiveByCreator('g', 'u')).toBe(MAX_ACTIVE_GROUPS_PER_CREATOR);
    expect(checkCreateGroup(dungeon, 'templar', repo.countActiveByCreator('g', 'u'))).toEqual({
      ok: false,
      message: 'You already have 3 open groups. Close one first.',
    });
    repo.update(groups[0].id, { status: 'closed' });
    expect(checkCreateGroup(dungeon, 'templar', repo.countActiveByCreator('g', 'u')).ok).toBe(true);
    expect(repo.countActiveByCreator('other', 'u')).toBe(0);
  });

  it('creates the group with its first member in one go and marks a 1-slot group full', () => {
    const repo = createGroupsRepo(db);
    const g = repo.createWithMember(
      { guildId: 'g', channelId: 'c', creatorId: 'u', title: 't', slotsJson: '[]', status: 'full' },
      { userId: 'u', classId: 'templar', slotIndex: 0 },
    );
    expect(g.status).toBe('full');
    expect(repo.listMembers(g.id)).toHaveLength(1);
  });
});
