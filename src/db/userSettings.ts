import type Database from 'better-sqlite3';

export function createUserSettingsRepo(db: Database.Database) {
  return {
    /** A user without a row counts as off. */
    getDmReminders(userId: string): boolean {
      const row = db.prepare('SELECT dm_reminders FROM user_settings WHERE user_id = ?').get(userId) as { dm_reminders: number } | undefined;
      return row?.dm_reminders === 1;
    },
    setDmReminders(userId: string, enabled: boolean): void {
      db.prepare(
        'INSERT INTO user_settings (user_id, dm_reminders) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET dm_reminders = excluded.dm_reminders',
      ).run(userId, enabled ? 1 : 0);
    },
    /** The subset of the users who enabled DM reminders. */
    filterDmEnabled(userIds: readonly string[]): string[] {
      return userIds.filter((id) => this.getDmReminders(id));
    },
  };
}

export type UserSettingsRepo = ReturnType<typeof createUserSettingsRepo>;
