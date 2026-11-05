import type Database from 'better-sqlite3';
import { statusForFill } from '../domain/groups.js';
import { assignSlot, parseSlotsJson } from '../domain/templates.js';

export type GroupStatus = 'open' | 'full' | 'closed';
/** `lfg`: posted by anyone in the groups channel, the creator plays in it. `event`: planned by organizers in the events channel. */
export type GroupKind = 'lfg' | 'event';

export interface GroupTemplate {
  id: number;
  /** null = built-in template available to every guild. */
  guildId: string | null;
  name: string;
  slotsJson: string;
}

export interface GroupRecord {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  templateId: number | null;
  title: string;
  description: string;
  /** Copy of the template's slots; later template edits don't touch the group. */
  slotsJson: string;
  startsAt: number | null;
  status: GroupStatus;
  kind: GroupKind;
  createdAt: number;
  /** Unix time the reminder went out; null while it is still pending (or the group has no start time). */
  remindedAt: number | null;
  /** How long the event runs; it ends (and a repeating one is posted again) after that. null = the default expiry after start. */
  durationSeconds: number | null;
  /** Days until the next occurrence of a repeating event; null = no repeat. */
  repeatDays: number | null;
  /** Channel messages of the start reminder, deleted once the group closes (ended, cancelled or rolled over). */
  reminderMessageIds: string[];
}

export interface NewGroup {
  guildId: string;
  channelId: string;
  messageId?: string | null;
  creatorId: string;
  templateId?: number | null;
  title: string;
  description?: string;
  slotsJson: string;
  startsAt?: number | null;
  status?: GroupStatus;
  kind?: GroupKind;
  createdAt?: number;
  durationSeconds?: number | null;
  repeatDays?: number | null;
}

export type GroupUpdate = Partial<
  Pick<GroupRecord, 'channelId' | 'creatorId' | 'messageId' | 'templateId' | 'title' | 'description' | 'startsAt' | 'status' | 'remindedAt' | 'durationSeconds' | 'repeatDays' | 'reminderMessageIds'>
>;

export interface GroupMember {
  groupId: number;
  userId: string;
  classId: string;
  slotIndex: number;
  joinedAt: number;
}

interface TemplateRow {
  id: number;
  guild_id: string | null;
  name: string;
  slots_json: string;
}

interface GroupRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  template_id: number | null;
  title: string;
  description: string;
  slots_json: string;
  starts_at: number | null;
  status: GroupStatus;
  kind: GroupKind;
  created_at: number;
  reminded_at: number | null;
  duration_seconds: number | null;
  repeat_days: number | null;
  reminder_message_ids: string | null;
}

interface MemberRow {
  group_id: number;
  user_id: string;
  class_id: string;
  slot_index: number;
  joined_at: number;
}

const toTemplate = (r: TemplateRow): GroupTemplate => ({ id: r.id, guildId: r.guild_id, name: r.name, slotsJson: r.slots_json });

const toGroup = (r: GroupRow): GroupRecord => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  messageId: r.message_id,
  creatorId: r.creator_id,
  templateId: r.template_id,
  title: r.title,
  description: r.description,
  slotsJson: r.slots_json,
  startsAt: r.starts_at,
  status: r.status,
  kind: r.kind,
  createdAt: r.created_at,
  remindedAt: r.reminded_at,
  durationSeconds: r.duration_seconds,
  repeatDays: r.repeat_days,
  reminderMessageIds: r.reminder_message_ids ? (JSON.parse(r.reminder_message_ids) as string[]) : [],
});

const toMember = (r: MemberRow): GroupMember => ({
  groupId: r.group_id,
  userId: r.user_id,
  classId: r.class_id,
  slotIndex: r.slot_index,
  joinedAt: r.joined_at,
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

const COLUMNS: Record<keyof GroupUpdate, string> = {
  channelId: 'channel_id',
  creatorId: 'creator_id',
  messageId: 'message_id',
  templateId: 'template_id',
  title: 'title',
  description: 'description',
  startsAt: 'starts_at',
  status: 'status',
  remindedAt: 'reminded_at',
  durationSeconds: 'duration_seconds',
  repeatDays: 'repeat_days',
  reminderMessageIds: 'reminder_message_ids',
};

export function createGroupTemplatesRepo(db: Database.Database) {
  return {
    create(t: { guildId: string | null; name: string; slotsJson: string }): GroupTemplate {
      const info = db.prepare('INSERT INTO group_templates (guild_id, name, slots_json) VALUES (?, ?, ?)').run(t.guildId, t.name, t.slotsJson);
      return { id: Number(info.lastInsertRowid), ...t };
    },
    get(id: number): GroupTemplate | undefined {
      const row = db.prepare('SELECT * FROM group_templates WHERE id = ?').get(id) as TemplateRow | undefined;
      return row && toTemplate(row);
    },
    /** Built-in templates (guild_id NULL) plus the guild's own. */
    listForGuild(guildId: string): GroupTemplate[] {
      const rows = db
        .prepare('SELECT * FROM group_templates WHERE guild_id IS NULL OR guild_id = ? ORDER BY id')
        .all(guildId) as TemplateRow[];
      return rows.map(toTemplate);
    },
    /** Template visible to the guild (built-in or its own) with this name, case-insensitive. */
    findByName(guildId: string, name: string): GroupTemplate | undefined {
      const row = db
        .prepare('SELECT * FROM group_templates WHERE (guild_id IS NULL OR guild_id = ?) AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1')
        .get(guildId, name) as TemplateRow | undefined;
      return row && toTemplate(row);
    },
    /**
     * Inserts missing built-in templates (guild_id NULL), updates the slots of existing ones, matched by name, and
     * deletes built-ins no longer in the list. Groups keep their own copy of the slots, so they are unaffected.
     */
    syncBuiltins(templates: readonly { name: string; slotsJson: string }[]): void {
      const find = db.prepare('SELECT id FROM group_templates WHERE guild_id IS NULL AND name = ?');
      const insert = db.prepare('INSERT INTO group_templates (guild_id, name, slots_json) VALUES (NULL, ?, ?)');
      const update = db.prepare('UPDATE group_templates SET slots_json = ? WHERE id = ?');
      const names = templates.map((t) => t.name);
      db.transaction(() => {
        db.prepare(`DELETE FROM group_templates WHERE guild_id IS NULL AND name NOT IN (${names.map(() => '?').join(', ')})`).run(...names);
        for (const t of templates) {
          const row = find.get(t.name) as { id: number } | undefined;
          if (row) update.run(t.slotsJson, row.id);
          else insert.run(t.name, t.slotsJson);
        }
      })();
    },
    update(id: number, patch: { name?: string; slotsJson?: string }): GroupTemplate | undefined {
      db.prepare('UPDATE group_templates SET name = COALESCE(?, name), slots_json = COALESCE(?, slots_json) WHERE id = ?').run(
        patch.name ?? null,
        patch.slotsJson ?? null,
        id,
      );
      return this.get(id);
    },
    delete(id: number): boolean {
      return db.prepare('DELETE FROM group_templates WHERE id = ?').run(id).changes > 0;
    },
  };
}

export function createGroupsRepo(db: Database.Database) {
  return {
    create(g: NewGroup): GroupRecord {
      const info = db
        .prepare(
          `INSERT INTO groups (guild_id, channel_id, message_id, creator_id, template_id, title, description, slots_json, starts_at, status, kind, created_at, duration_seconds, repeat_days)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          g.guildId,
          g.channelId,
          g.messageId ?? null,
          g.creatorId,
          g.templateId ?? null,
          g.title,
          g.description ?? '',
          g.slotsJson,
          g.startsAt ?? null,
          g.status ?? 'open',
          g.kind ?? 'lfg',
          g.createdAt ?? nowSeconds(),
          g.durationSeconds ?? null,
          g.repeatDays ?? null,
        );
      return this.get(Number(info.lastInsertRowid))!;
    },
    /** Inserts the group and its first member in one transaction. */
    createWithMember(g: NewGroup, member: { userId: string; classId: string; slotIndex: number }): GroupRecord {
      return db.transaction(() => {
        const group = this.create(g);
        this.addMember(group.id, member.userId, member.classId, member.slotIndex, group.createdAt);
        return group;
      })();
    },
    /** LFG groups of the creator in the guild with status open or full; events don't count. */
    countActiveByCreator(guildId: string, creatorId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM groups WHERE guild_id = ? AND creator_id = ? AND kind = 'lfg' AND status IN ('open', 'full')")
        .get(guildId, creatorId) as { n: number };
      return row.n;
    },
    /** The groups countActiveByCreator counts. */
    listActiveByCreator(guildId: string, creatorId: string): GroupRecord[] {
      const rows = db
        .prepare("SELECT * FROM groups WHERE guild_id = ? AND creator_id = ? AND kind = 'lfg' AND status IN ('open', 'full') ORDER BY id")
        .all(guildId, creatorId) as GroupRow[];
      return rows.map(toGroup);
    },
    /** Open or full groups whose post is one of the given messages. */
    listActiveByMessageIds(messageIds: readonly string[]): GroupRecord[] {
      if (messageIds.length === 0) return [];
      const rows = db
        .prepare(`SELECT * FROM groups WHERE status IN ('open', 'full') AND message_id IN (${messageIds.map(() => '?').join(', ')}) ORDER BY id`)
        .all(...messageIds) as GroupRow[];
      return rows.map(toGroup);
    },
    get(id: number): GroupRecord | undefined {
      const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
      return row && toGroup(row);
    },
    listByGuild(guildId: string, status?: GroupStatus): GroupRecord[] {
      const rows = status
        ? db.prepare('SELECT * FROM groups WHERE guild_id = ? AND status = ? ORDER BY id').all(guildId, status)
        : db.prepare('SELECT * FROM groups WHERE guild_id = ? ORDER BY id').all(guildId);
      return (rows as GroupRow[]).map(toGroup);
    },
    /**
     * Open or full groups past their expiry: the end (`starts_at + duration`) when they have a duration, else `starts_at + afterStart`,
     * or `created_at + afterCreate` without a start time.
     */
    listExpired(now: number, afterStartSeconds: number, afterCreateSeconds: number): GroupRecord[] {
      const rows = db
        .prepare(
          `SELECT * FROM groups WHERE status IN ('open', 'full')
           AND ((starts_at IS NOT NULL AND starts_at + COALESCE(duration_seconds, ?) <= ?) OR (starts_at IS NULL AND created_at + ? <= ?)) ORDER BY id`,
        )
        .all(afterStartSeconds, now, afterCreateSeconds, now) as GroupRow[];
      return rows.map(toGroup);
    },
    /** Open or full groups not yet reminded that start within `leadSeconds` after `now` (and not at or before it). */
    listDueForReminder(now: number, leadSeconds: number): GroupRecord[] {
      const rows = db
        .prepare(
          `SELECT * FROM groups WHERE status IN ('open', 'full') AND reminded_at IS NULL AND starts_at IS NOT NULL
           AND starts_at - ? <= ? AND ? < starts_at ORDER BY starts_at, id`,
        )
        .all(leadSeconds, now, now) as GroupRow[];
      return rows.map(toGroup);
    },
    update(id: number, patch: GroupUpdate): GroupRecord | undefined {
      const keys = (Object.keys(patch) as (keyof GroupUpdate)[]).filter((k) => patch[k] !== undefined);
      if (keys.length > 0) {
        const set = keys.map((k) => `${COLUMNS[k]} = @${k}`).join(', ');
        const { reminderMessageIds, ...rest } = patch;
        const params = { ...rest, ...(reminderMessageIds ? { reminderMessageIds: reminderMessageIds.length ? JSON.stringify(reminderMessageIds) : null } : {}), id };
        db.prepare(`UPDATE groups SET ${set} WHERE id = @id`).run(params);
      }
      return this.get(id);
    },
    delete(id: number): boolean {
      return db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes > 0;
    },
    /**
     * Closes a repeating event and creates its next occurrence at `startsAt`, in one transaction: same channel, organizer, slots,
     * duration and repeat, but no members, no post yet and a pending reminder. Returns the closed and the new group.
     */
    rollOver(groupId: number, startsAt: number, now = nowSeconds()): { closed: GroupRecord; next: GroupRecord } | undefined {
      return db.transaction(() => {
        const group = this.get(groupId);
        if (!group) return undefined;
        const closed = this.update(groupId, { status: 'closed' })!;
        const next = this.create({
          guildId: group.guildId,
          channelId: group.channelId,
          creatorId: group.creatorId,
          templateId: group.templateId,
          title: group.title,
          description: group.description,
          slotsJson: group.slotsJson,
          startsAt,
          status: statusForFill(parseSlotsJson(group.slotsJson), []),
          kind: group.kind,
          createdAt: now,
          durationSeconds: group.durationSeconds,
          repeatDays: group.repeatDays,
        });
        return { closed, next };
      })();
    },

    /** Throws a SqliteError (constraint) when the user is already a member or the slot is taken. */
    addMember(groupId: number, userId: string, classId: string, slotIndex: number, joinedAt = nowSeconds()): GroupMember {
      db.prepare('INSERT INTO group_members (group_id, user_id, class_id, slot_index, joined_at) VALUES (?, ?, ?, ?, ?)').run(
        groupId,
        userId,
        classId,
        slotIndex,
        joinedAt,
      );
      return { groupId, userId, classId, slotIndex, joinedAt };
    },
    getMember(groupId: number, userId: string): GroupMember | undefined {
      const row = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId) as MemberRow | undefined;
      return row && toMember(row);
    },
    listMembers(groupId: number): GroupMember[] {
      const rows = db.prepare('SELECT * FROM group_members WHERE group_id = ? ORDER BY slot_index').all(groupId) as MemberRow[];
      return rows.map(toMember);
    },
    updateMember(groupId: number, userId: string, patch: { classId?: string; slotIndex?: number }): boolean {
      return (
        db
          .prepare('UPDATE group_members SET class_id = COALESCE(?, class_id), slot_index = COALESCE(?, slot_index) WHERE group_id = ? AND user_id = ?')
          .run(patch.classId ?? null, patch.slotIndex ?? null, groupId, userId).changes > 0
      );
    },
    removeMember(groupId: number, userId: string): boolean {
      return db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId).changes > 0;
    },

    /**
     * Places the user in the best free slot for the class, or moves an existing member to one (their own slot counts as free).
     * Runs in one transaction; the UNIQUE (group_id, slot_index) constraint backs it up.
     */
    joinMember(groupId: number, userId: string, classId: string): JoinResult {
      return db.transaction((): JoinResult => {
        const group = this.get(groupId);
        if (!group) return { ok: false, reason: 'not_found' };
        if (group.status === 'closed') return { ok: false, reason: 'closed' };
        const slots = parseSlotsJson(group.slotsJson);
        const before = this.listMembers(groupId);
        const existing = before.some((m) => m.userId === userId);
        const slotIndex = assignSlot(
          slots,
          before.filter((m) => m.userId !== userId),
          classId,
        );
        if (slotIndex === null) return { ok: false, reason: 'no_slot' };
        if (existing) {
          // Moving to a free slot never collides: the target is not taken by anyone else.
          this.updateMember(groupId, userId, { classId, slotIndex });
        } else {
          this.addMember(groupId, userId, classId, slotIndex);
        }
        const members = this.listMembers(groupId);
        const status = statusForFill(slots, members);
        const updated = this.update(groupId, { status })!;
        return { ok: true, group: updated, members, slotIndex, switched: existing, becameFull: group.status !== 'full' && status === 'full' };
      })();
    },
    /** Removes a member on behalf of a manager. The creator can't be kicked; the group reopens if it was full. */
    kickMember(groupId: number, userId: string): KickResult {
      return db.transaction((): KickResult => {
        const group = this.get(groupId);
        if (!group) return { ok: false, reason: 'not_found' };
        if (group.status === 'closed') return { ok: false, reason: 'closed' };
        if (group.creatorId === userId) return { ok: false, reason: 'creator' };
        if (!this.removeMember(groupId, userId)) return { ok: false, reason: 'not_member' };
        const members = this.listMembers(groupId);
        const updated = this.update(groupId, { status: statusForFill(parseSlotsJson(group.slotsJson), members) })!;
        return { ok: true, group: updated, members };
      })();
    },
    /**
     * Removes the member. An LFG group goes to the earliest remaining member if the creator left and closes when empty;
     * an event keeps its organizer and stays open.
     */
    leaveMember(groupId: number, userId: string): LeaveResult {
      return db.transaction((): LeaveResult => {
        const group = this.get(groupId);
        if (!group) return { ok: false, reason: 'not_found' };
        if (group.status === 'closed') return { ok: false, reason: 'closed' };
        if (!this.removeMember(groupId, userId)) return { ok: false, reason: 'not_member' };
        const members = this.listMembers(groupId);
        const patch: GroupUpdate = {};
        let newCreatorId: string | null = null;
        if (members.length === 0 && group.kind === 'lfg') {
          patch.status = 'closed';
        } else {
          patch.status = statusForFill(parseSlotsJson(group.slotsJson), members);
          if (group.creatorId === userId && group.kind === 'lfg') {
            const earliest = [...members].sort((a, b) => a.joinedAt - b.joinedAt || a.slotIndex - b.slotIndex)[0]!;
            newCreatorId = earliest.userId;
            patch.creatorId = newCreatorId;
          }
        }
        return { ok: true, group: this.update(groupId, patch)!, members, newCreatorId };
      })();
    },
  };
}

export type JoinResult =
  | { ok: true; group: GroupRecord; members: GroupMember[]; slotIndex: number; switched: boolean; becameFull: boolean }
  | { ok: false; reason: 'not_found' | 'closed' | 'no_slot' };

export type LeaveResult =
  | { ok: true; group: GroupRecord; members: GroupMember[]; newCreatorId: string | null }
  | { ok: false; reason: 'not_found' | 'closed' | 'not_member' };

export type KickResult =
  | { ok: true; group: GroupRecord; members: GroupMember[] }
  | { ok: false; reason: 'not_found' | 'closed' | 'creator' | 'not_member' };

export type GroupsRepo = ReturnType<typeof createGroupsRepo>;
export type GroupTemplatesRepo = ReturnType<typeof createGroupTemplatesRepo>;
