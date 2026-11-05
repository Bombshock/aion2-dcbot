export type Role = 'tank' | 'dps' | 'healer';

export interface AionClass {
  id: string;
  name: string;
  role: Role;
  /** Icon file / emoji name, shared by entries of the same class with different roles; defaults to `id`. */
  icon?: string;
  /** Unicode fallback; replaced at startup by the class icon's application emoji (`<:aion2_x:id>`). */
  emoji: string;
}

/** All classes confirmed for the global servers. Order = display order everywhere. */
export const CLASSES: readonly AionClass[] = [
  { id: 'gladiator', name: 'Gladiator', role: 'tank', emoji: '⚔️' },
  // Gladiators can tank or deal damage; `gladiator` stays the tank so stored sign-ups keep their role.
  { id: 'gladiator_dps', name: 'Gladiator', role: 'dps', icon: 'gladiator', emoji: '⚔️' },
  { id: 'templar', name: 'Templar', role: 'tank', emoji: '🛡️' },
  { id: 'assassin', name: 'Assassin', role: 'dps', emoji: '🗡️' },
  { id: 'ranger', name: 'Ranger', role: 'dps', emoji: '🏹' },
  { id: 'sorcerer', name: 'Sorcerer', role: 'dps', emoji: '🔥' },
  { id: 'spiritmaster', name: 'Spiritmaster', role: 'dps', emoji: '🌀' },
  { id: 'cleric', name: 'Cleric', role: 'healer', emoji: '✨' },
  { id: 'chanter', name: 'Chanter', role: 'dps', emoji: '🎵' },
  // Chanters can heal or deal damage; `chanter` stays DPS so stored sign-ups keep their role.
  { id: 'chanter_healer', name: 'Chanter', role: 'healer', icon: 'chanter', emoji: '🎵' },
];

/** Roles in display order with the plural label used for roster headings. */
export const ROLES: readonly { role: Role; label: string }[] = [
  { role: 'tank', label: 'Tanks' },
  { role: 'healer', label: 'Heiler' },
  { role: 'dps', label: 'DPS' },
];

/** Singular role name, e.g. for `"Gladiator (Tank)"`. */
const ROLE_NAME: Record<Role, string> = { tank: 'Tank', healer: 'Heiler', dps: 'DPS' };

/**
 * Icon of each role, plus `any` for slots that accept classes of more than one role. Unicode fallbacks; replaced at
 * startup by the role icon's application emoji.
 */
export const ROLE_EMOJI: Record<Role | 'any', string> = { tank: '🛡️', healer: '💚', dps: '⚔️', any: '👤' };
/** Icon of classes no longer in the catalog. */
export const UNKNOWN_ROLE_EMOJI = '❔';

export function getClass(id: string): AionClass | undefined {
  return CLASSES.find((c) => c.id === id);
}

export function classesByRole(role: Role): AionClass[] {
  return CLASSES.filter((c) => c.role === role);
}

/** `"Gladiator (Tank)"` for classes listed with several roles, otherwise just the name. */
export function classLabel(c: AionClass): string {
  if (CLASSES.filter((o) => o.name === c.name).length < 2) return c.name;
  return `${c.name} (${ROLE_NAME[c.role]})`;
}

/** `"⚔️ Gladiator (Tank)"`; an unknown id (e.g. a removed class still stored in the DB) is returned as is. */
export function formatClass(id: string): string {
  const c = getClass(id);
  return c ? `${c.emoji} ${classLabel(c)}` : id;
}
