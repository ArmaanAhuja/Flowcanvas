import { describe, expect, it } from 'vitest';
import { NODE_TEXT, linesFor, nodeHeight, wrapSegments } from './wrap';

describe('wrapSegments', () => {
  it('breaks identifiers at their words, and paths after a folder or a dash, never inside the extension', () => {
    expect(wrapSegments('canAccessTeamDocument')).toEqual(['can', 'Access', 'Team', 'Document']);
    expect(wrapSegments('item.created')).toEqual(['item.', 'created']);
    expect(wrapSegments('folder/delete-folder.ts:14')).toEqual([
      'folder/',
      'delete-',
      'folder.ts:14',
    ]);
    expect(wrapSegments('app/api/items/route.ts:9')).toEqual([
      'app/',
      'api/',
      'items/',
      'route.ts:9',
    ]);
    expect(wrapSegments('getUTF8Value')).toEqual(['get', 'UTF8', 'Value']);
    expect(wrapSegments('if')).toEqual(['if']);
  });
});

describe('linesFor', () => {
  it('fits words on a line, starts a new line between words, and splits a word only when it alone is too long', () => {
    expect(linesFor('getTeam', 8, 166)).toBe(1);
    // 21 characters × 8 px = 168 px: "canAccessTeam" on one line, "Document" on the next.
    expect(linesFor('canAccessTeamDocument', 8, 166)).toBe(2);
    expect(linesFor('x'.repeat(50), 8, 166)).toBe(3);
  });
});

describe('nodeHeight', () => {
  it('is Graphite’s 56 px for one line of each, and grows by a line’s height for each extra line', () => {
    expect(nodeHeight('getTeam', 'team/get-team.ts:38')).toBe(56);
    expect(nodeHeight('canAccessTeamDocument', 'utils/teams.ts:61')).toBe(56 + NODE_TEXT.titleLine);
    expect(nodeHeight('getTeam', 'packages/lib/server-only/team/get-team.ts:38')).toBe(
      56 + NODE_TEXT.locationLine,
    );
  });
});
