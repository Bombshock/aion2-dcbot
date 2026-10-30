import { describe, expect, it } from 'vitest';
import { buildCustomId, parseCustomId } from './router.js';

describe('customId', () => {
  it('parses <area>:<action>:<id>', () => {
    expect(parseCustomId('evt:join:42')).toEqual({ area: 'evt', action: 'join', id: '42' });
  });

  it('round-trips', () => {
    expect(parseCustomId(buildCustomId('grp', 'leave', 7))).toEqual({ area: 'grp', action: 'leave', id: '7' });
  });

  it('rejects malformed ids', () => {
    expect(parseCustomId('nope')).toBeNull();
  });
});
