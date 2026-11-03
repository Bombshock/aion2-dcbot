export type Role = 'tank' | 'dps' | 'healer' | 'support';

export interface AionClass {
  id: string;
  name: string;
  role: Role;
  /** Unicode fallback; replaced at startup by the class icon's application emoji (`<:aion2_x:id>`). */
  emoji: string;
}

/** All classes confirmed for the global servers. Order = display order everywhere. */
export const CLASSES: readonly AionClass[] = [
  { id: 'gladiator', name: 'Gladiator', role: 'tank', emoji: '⚔️' },
  { id: 'templar', name: 'Templar', role: 'tank', emoji: '🛡️' },
  { id: 'assassin', name: 'Assassin', role: 'dps', emoji: '🗡️' },
  { id: 'ranger', name: 'Ranger', role: 'dps', emoji: '🏹' },
  { id: 'sorcerer', name: 'Sorcerer', role: 'dps', emoji: '🔥' },
  { id: 'spiritmaster', name: 'Spiritmaster', role: 'dps', emoji: '🌀' },
  { id: 'cleric', name: 'Cleric', role: 'healer', emoji: '✨' },
  { id: 'chanter', name: 'Chanter', role: 'support', emoji: '🎵' },
];

/** Roles in display order with the plural label used for roster headings. */
export const ROLES: readonly { role: Role; label: string }[] = [
  { role: 'tank', label: 'Tanks' },
  { role: 'healer', label: 'Heiler' },
  { role: 'dps', label: 'DPS' },
  { role: 'support', label: 'Support' },
];

/** Icon of each role, shown on group slots. */
export const ROLE_EMOJI: Readonly<Record<Role, string>> = { tank: '🛡️', healer: '💚', dps: '⚔️', support: '🎵' };
/** Icon of slots that accept classes of more than one role. */
export const MIXED_ROLE_EMOJI = '👤';
/** Icon of classes no longer in the catalog. */
export const UNKNOWN_ROLE_EMOJI = '❔';

export function getClass(id: string): AionClass | undefined {
  return CLASSES.find((c) => c.id === id);
}

export function classesByRole(role: Role): AionClass[] {
  return CLASSES.filter((c) => c.role === role);
}

/** `"⚔️ Gladiator"`; an unknown id (e.g. a removed class still stored in the DB) is returned as is. */
export function formatClass(id: string): string {
  const c = getClass(id);
  return c ? `${c.emoji} ${c.name}` : id;
}
