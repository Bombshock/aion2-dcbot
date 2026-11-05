import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createGroupsRepo } from '../db/groups.js';
import { openDb } from '../db/index.js';
import { applySchema } from '../db/schema.js';
import {
  buildFooter,
  buildGroupEmbed,
  buildSlotColumns,
  checkCreateGroup,
  formatTimeChangeNotice,
  MAX_ACTIVE_GROUPS_PER_CREATOR,
  statusForFill,
  type GroupView,
} from './groups.js';
import { parseTemplateText, serializeSlots, type TemplateSlot } from './templates.js';

const dungeon = (parseTemplateText('Tank: tank\nHealer: healer\nDPS: dps\nDPS: dps\nAny: any') as { value: TemplateSlot[] }).value;

describe('buildSlotColumns', () => {
  it('groups slots by role with fill counts, class icon for players and "open" for free slots', () => {
    const columns = buildSlotColumns(dungeon, [{ userId: '1', classId: 'templar', slotIndex: 0 }, { userId: '2', classId: 'ranger', slotIndex: 3 }]);
    expect(columns).toEqual([
      { name: '🛡️ Tanks (1/1)', lines: ['🛡️ <@1>'] },
      { name: '💚 Heiler (0/1)', lines: ['frei'] },
      { name: '⚔️ DPS (1/2)', lines: ['frei', '🏹 <@2>'] },
      { name: '👤 Beliebig (0/1)', lines: ['frei'] },
    ]);
  });
  it('puts slots spanning several roles under Any', () => {
    expect(buildSlotColumns([{ label: 'Chanter', allowed: ['chanter'] }], [])).toEqual([{ name: '⚔️ DPS (0/1)', lines: ['frei'] }]);
    expect(buildSlotColumns([{ label: 'Frontline', allowed: ['templar', 'gladiator', 'cleric'] }], [])[0]!.name).toBe('👤 Beliebig (0/1)');
  });
});

describe('buildFooter', () => {
  it('reports open and full groups', () => {
    const one = [{ userId: '1', classId: 'templar', slotIndex: 0 }];
    expect(buildFooter(dungeon, one, 'open')).toBe('1/5 · offen');
    const all = dungeon.map((_, i) => ({ userId: String(i), classId: 'templar', slotIndex: i }));
    expect(buildFooter(dungeon, all, 'full')).toBe('5/5 · voll ✅');
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
  const ZWSP = String.fromCharCode(0x200b);
  const group: GroupView = { id: 1, creatorId: '1', title: 'Run', description: 'Go', startsAt: null, status: 'open', kind: 'lfg', slots: dungeon };
  it('says Now without a time and uses timestamps with one', () => {
    expect(buildGroupEmbed(group, []).fields[0].value).toBe('Jetzt');
    expect(buildGroupEmbed({ ...group, startsAt: 100 }, []).fields[0].value).toBe('<t:100:F> (<t:100:R>)');
    expect(buildGroupEmbed({ ...group, startsAt: 100, durationSeconds: 7200, repeatDays: 7 }, []).fields[0].value).toBe(
      '<t:100:F> (<t:100:R>)\nbis <t:7300:t>\n🔁 Jede Woche',
    );
  });
  it('shows the role columns inline after a row break', () => {
    const fields = buildGroupEmbed(group, []).fields;
    expect(fields[2]).toEqual({ name: ZWSP, value: ZWSP });
    expect(fields.slice(3).map((f) => [f.name, f.inline])).toEqual([
      ['🛡️ Tanks (0/1)', true],
      ['💚 Heiler (0/1)', true],
      ['⚔️ DPS (0/2)', true],
      ['👤 Beliebig (0/1)', true],
    ]);
  });
  it('leaves out an empty description', () => {
    expect(buildGroupEmbed({ ...group, description: '' }, [])).not.toHaveProperty('description');
  });
  it('names the creator of an event its organizer', () => {
    expect(buildGroupEmbed(group, []).fields[1].name).toBe('Ersteller');
    expect(buildGroupEmbed({ ...group, kind: 'event' }, []).fields[1].name).toBe('Organisator');
  });
});

describe('formatTimeChangeNotice', () => {
  it('mentions everyone and names the new time', () => {
    expect(formatTimeChangeNotice(['1', '2'], 1900000000)).toBe('<@1> <@2> Zeit geändert auf <t:1900000000:F>');
    expect(formatTimeChangeNotice([], 1900000000)).toBe('Zeit geändert auf <t:1900000000:F>');
  });
  it('stays within 2000 characters', () => {
    const ids = Array.from({ length: 200 }, (_, i) => String(100000000000000000n + BigInt(i)));
    expect(formatTimeChangeNotice(ids, 1900000000).length).toBeLessThanOrEqual(2000);
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
    expect(r).toEqual({ ok: false, message: 'Deine Klasse passt auf keinen Platz dieser Vorlage. Passende Klassen: Gladiator (Tank), Templar' });
  });

  it('refuses a 4th open group; closed groups do not count', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 't', slotsJson: serializeSlots(dungeon) };
    const groups = [0, 1, 2].map(() => repo.create(base));
    expect(repo.countActiveByCreator('g', 'u')).toBe(MAX_ACTIVE_GROUPS_PER_CREATOR);
    expect(checkCreateGroup(dungeon, 'templar', repo.countActiveByCreator('g', 'u'))).toEqual({
      ok: false,
      message: 'Du hast bereits 3 offene Gruppen. Schließe zuerst eine.',
    });
    repo.update(groups[0].id, { status: 'closed' });
    expect(checkCreateGroup(dungeon, 'templar', repo.countActiveByCreator('g', 'u')).ok).toBe(true);
    repo.create({ ...base, kind: 'event' });
    expect(repo.countActiveByCreator('g', 'u')).toBe(2);
    expect(repo.countActiveByCreator('other', 'u')).toBe(0);
    expect(repo.listActiveByCreator('g', 'u').map((g) => g.id)).toEqual([groups[1].id, groups[2].id]);
  });

  it('finds open groups by the message ids of their posts', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 't', slotsJson: serializeSlots(dungeon) };
    const a = repo.create({ ...base, messageId: 'm1' });
    repo.create({ ...base, messageId: 'm2', status: 'closed' });
    repo.create({ ...base, messageId: 'm3' });
    expect(repo.listActiveByMessageIds(['m1', 'm2', 'x']).map((g) => g.id)).toEqual([a.id]);
    expect(repo.listActiveByMessageIds([])).toEqual([]);
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
