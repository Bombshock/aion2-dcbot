import type Database from 'better-sqlite3';

export type EventStatus = 'open' | 'cancelled' | 'ended';

export interface EventRecord {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  title: string;
  description: string;
  startsAt: number;
  status: EventStatus;
  createdAt: number;
}

export interface NewEvent {
  guildId: string;
  channelId: string;
  messageId?: string | null;
  creatorId: string;
  title: string;
  description?: string;
  startsAt: number;
  createdAt?: number;
}

export type EventUpdate = Partial<Pick<EventRecord, 'channelId' | 'messageId' | 'title' | 'description' | 'startsAt' | 'status'>>;

export interface EventSignup {
  eventId: number;
  userId: string;
  classId: string;
  signedUpAt: number;
}

interface EventRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  title: string;
  description: string;
  starts_at: number;
  status: EventStatus;
  created_at: number;
}

interface SignupRow {
  event_id: number;
  user_id: string;
  class_id: string;
  signed_up_at: number;
}

const toEvent = (r: EventRow): EventRecord => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  messageId: r.message_id,
  creatorId: r.creator_id,
  title: r.title,
  description: r.description,
  startsAt: r.starts_at,
  status: r.status,
  createdAt: r.created_at,
});

const toSignup = (r: SignupRow): EventSignup => ({
  eventId: r.event_id,
  userId: r.user_id,
  classId: r.class_id,
  signedUpAt: r.signed_up_at,
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

const COLUMNS: Record<keyof EventUpdate, string> = {
  channelId: 'channel_id',
  messageId: 'message_id',
  title: 'title',
  description: 'description',
  startsAt: 'starts_at',
  status: 'status',
};

export function createEventsRepo(db: Database.Database) {
  return {
    create(e: NewEvent): EventRecord {
      const info = db
        .prepare(
          `INSERT INTO events (guild_id, channel_id, message_id, creator_id, title, description, starts_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(e.guildId, e.channelId, e.messageId ?? null, e.creatorId, e.title, e.description ?? '', e.startsAt, e.createdAt ?? nowSeconds());
      return this.get(Number(info.lastInsertRowid))!;
    },
    get(id: number): EventRecord | undefined {
      const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
      return row && toEvent(row);
    },
    listByGuild(guildId: string, status?: EventStatus): EventRecord[] {
      const rows = status
        ? db.prepare('SELECT * FROM events WHERE guild_id = ? AND status = ? ORDER BY starts_at, id').all(guildId, status)
        : db.prepare('SELECT * FROM events WHERE guild_id = ? ORDER BY starts_at, id').all(guildId);
      return (rows as EventRow[]).map(toEvent);
    },
    /** Open events starting in the range [from, to). */
    listOpenStartingBetween(from: number, to: number): EventRecord[] {
      const rows = db
        .prepare(`SELECT * FROM events WHERE status = 'open' AND starts_at >= ? AND starts_at < ? ORDER BY starts_at, id`)
        .all(from, to) as EventRow[];
      return rows.map(toEvent);
    },
    update(id: number, patch: EventUpdate): EventRecord | undefined {
      const keys = (Object.keys(patch) as (keyof EventUpdate)[]).filter((k) => patch[k] !== undefined);
      if (keys.length > 0) {
        const set = keys.map((k) => `${COLUMNS[k]} = @${k}`).join(', ');
        db.prepare(`UPDATE events SET ${set} WHERE id = @id`).run({ ...patch, id });
      }
      return this.get(id);
    },
    delete(id: number): boolean {
      return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;
    },

    /** Throws a SqliteError (constraint) when the user is already signed up. */
    addSignup(eventId: number, userId: string, classId: string, signedUpAt = nowSeconds()): EventSignup {
      db.prepare('INSERT INTO event_signups (event_id, user_id, class_id, signed_up_at) VALUES (?, ?, ?, ?)').run(
        eventId,
        userId,
        classId,
        signedUpAt,
      );
      return { eventId, userId, classId, signedUpAt };
    },
    getSignup(eventId: number, userId: string): EventSignup | undefined {
      const row = db.prepare('SELECT * FROM event_signups WHERE event_id = ? AND user_id = ?').get(eventId, userId) as SignupRow | undefined;
      return row && toSignup(row);
    },
    listSignups(eventId: number): EventSignup[] {
      const rows = db.prepare('SELECT * FROM event_signups WHERE event_id = ? ORDER BY signed_up_at, user_id').all(eventId) as SignupRow[];
      return rows.map(toSignup);
    },
    updateSignupClass(eventId: number, userId: string, classId: string): boolean {
      return db.prepare('UPDATE event_signups SET class_id = ? WHERE event_id = ? AND user_id = ?').run(classId, eventId, userId).changes > 0;
    },
    removeSignup(eventId: number, userId: string): boolean {
      return db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ?').run(eventId, userId).changes > 0;
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
