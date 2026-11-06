import { describe, expect, it } from 'vitest';
import { isLeftover, postGroupId, notificationPostId, type CleanupGroupInfo, type CleanupLookup } from './cleanup.js';

const post = (id: string, groupId: number) => ({ id, content: '', customIds: [`grp:join:${groupId}`, `grp:leave:${groupId}`, `grp:manage:${groupId}`] });
const reminder = (id: string, postId: string) => ({ id, content: `⏰ **Raid** beginnt <t:1:R> — https://discord.com/channels/1/2/${postId}\n<@1>`, customIds: [] });

function lookup(groups: Record<number, CleanupGroupInfo & { post?: string }>, keep: string[] = []): CleanupLookup {
  return {
    group: (id) => groups[id],
    groupOfPost: (messageId) => Object.values(groups).find((g) => g.post === messageId),
    keep: new Set(keep),
  };
}

describe('message classification', () => {
  it('reads the group id of a post and the post id of a reminder', () => {
    expect(postGroupId(post('m', 7))).toBe(7);
    expect(postGroupId({ id: 'm', content: '', customIds: ['grp:start:'] })).toBeNull();
    expect(notificationPostId(reminder('r', '99'))).toBe('99');
    expect(notificationPostId({ id: 'a', content: 'hallo', customIds: [] })).toBeNull();
    expect(notificationPostId({ id: 'a', content: '<@1> Die Gruppe ist bereit!', customIds: [], referenceId: '55' })).toBe('55');
    expect(notificationPostId({ id: 'a', content: '<@1> <@2> Die Gruppe ist bereit!', customIds: [] })).toBe('');
    expect(notificationPostId({ id: 'a', content: '<@1> <@2> ist als Kleriker (Heiler) beigetreten.', customIds: [] })).toBe('');
  });
});

describe('isLeftover', () => {
  const groups = {
    1: { kind: 'event' as const, active: true, post: '101' },
    2: { kind: 'lfg' as const, active: true, post: '102' },
    3: { kind: 'event' as const, active: false, post: '103' },
  };
  const l = lookup(groups, ['101', '102']);

  it('keeps the current posts of active groups', () => {
    expect(isLeftover(post('101', 1), 'event', l)).toBe(false);
  });

  it('deletes posts of groups gone from the DB or closed', () => {
    expect(isLeftover(post('old', 42), 'event', l)).toBe(true);
    expect(isLeftover(post('103', 3), 'event', l)).toBe(true);
  });

  it('leaves the other kind alone', () => {
    expect(isLeftover(post('stale', 2), 'event', l)).toBe(false);
    expect(isLeftover(reminder('r', '102'), 'event', l)).toBe(false);
    expect(isLeftover(post('stale', 1), 'lfg', l)).toBe(false);
  });

  it('deletes reminders of closed or vanished groups, keeps those of active ones', () => {
    expect(isLeftover(reminder('r1', '101'), 'event', l)).toBe(false);
    expect(isLeftover(reminder('r3', '103'), 'event', l)).toBe(true);
    expect(isLeftover(reminder('rx', '999'), 'lfg', l)).toBe(true);
  });

  it('never touches the LFG panel or unrelated messages', () => {
    expect(isLeftover({ id: 'panel', content: '', customIds: ['grp:start:'] }, 'lfg', l)).toBe(false);
    expect(isLeftover({ id: 'x', content: 'Willkommen!', customIds: [] }, 'lfg', l)).toBe(false);
  });

  it('treats announcements like reminders', () => {
    const ready = (id: string, referenceId?: string) => ({ id, content: '<@1> Die Gruppe ist bereit!', customIds: [], referenceId });
    expect(isLeftover(ready('a1', '102'), 'lfg', l)).toBe(false);
    expect(isLeftover(ready('a3', '103'), 'event', l)).toBe(true);
    expect(isLeftover(ready('a3', '103'), 'lfg', l)).toBe(false);
    expect(isLeftover(ready('legacy'), 'lfg', l)).toBe(true);
    expect(isLeftover(ready('kept'), 'lfg', lookup(groups, ['kept']))).toBe(false);
  });
});
