import type Database from 'better-sqlite3';

export type GroupStatus = 'open' | 'full' | 'closed';

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
  startsAt: number | null;
  status: GroupStatus;
  createdAt: number;
}

export interface NewGroup {
  guildId: string;
  channelId: string;
  messageId?: string | null;
  creatorId: string;
  templateId?: number | null;
  title: string;
  description?: string;
  startsAt?: number | null;
  createdAt?: number;
}

export type GroupUpdate = Partial<
  Pick<GroupRecord, 'channelId' | 'messageId' | 'templateId' | 'title' | 'description' | 'startsAt' | 'status'>
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
  starts_at: number | null;
  status: GroupStatus;
  created_at: number;
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
  startsAt: r.starts_at,
  status: r.status,
  createdAt: r.created_at,
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
  messageId: 'message_id',
  templateId: 'template_id',
  title: 'title',
  description: 'description',
  startsAt: 'starts_at',
  status: 'status',
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
          `INSERT INTO groups (guild_id, channel_id, message_id, creator_id, template_id, title, description, starts_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          g.guildId,
          g.channelId,
          g.messageId ?? null,
          g.creatorId,
          g.templateId ?? null,
          g.title,
          g.description ?? '',
          g.startsAt ?? null,
          g.createdAt ?? nowSeconds(),
        );
      return this.get(Number(info.lastInsertRowid))!;
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
    update(id: number, patch: GroupUpdate): GroupRecord | undefined {
      const keys = (Object.keys(patch) as (keyof GroupUpdate)[]).filter((k) => patch[k] !== undefined);
      if (keys.length > 0) {
        const set = keys.map((k) => `${COLUMNS[k]} = @${k}`).join(', ');
        db.prepare(`UPDATE groups SET ${set} WHERE id = @id`).run({ ...patch, id });
      }
      return this.get(id);
    },
    delete(id: number): boolean {
      return db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes > 0;
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
  };
}

export type GroupsRepo = ReturnType<typeof createGroupsRepo>;
export type GroupTemplatesRepo = ReturnType<typeof createGroupTemplatesRepo>;
