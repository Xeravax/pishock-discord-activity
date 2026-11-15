import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChangelog } from '../src/client/changelogMarkdown.ts';

const notes = `## What's changed

### Friends & sharing
- Invite someone into the activity from the roster
- Share a shock, vibrate, or beep from the log

### Discord & layout
- Official remote layout fits more window sizes

**Full changelog**: https://github.com/Xeravax/pishock-discord-activity/compare/v2.1.1...v2.2.0
`;

describe('parseChangelog', () => {
  it('turns release notes into headings and bullet lists', () => {
    const blocks = parseChangelog(notes);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['heading', 'heading', 'list', 'heading', 'list', 'paragraph'],
    );
    assert.equal(blocks[0]?.type === 'heading' ? blocks[0].level : 0, 2);
    assert.equal(blocks[1]?.type === 'heading' ? blocks[1].level : 0, 3);
    assert.equal(blocks[2]?.type === 'list' ? blocks[2].items.length : 0, 2);
    const compare = blocks[5];
    assert.equal(compare?.type, 'paragraph');
    if (compare?.type === 'paragraph') {
      assert.equal(compare.inlines[0]?.type, 'strong');
      assert.equal(compare.inlines.at(-1)?.type, 'link');
    }
  });

  it('keeps a flat CI commit list as bullets, including #patch subjects', () => {
    const blocks = parseChangelog(
      ['## What\'s changed', '', '- #patch Refactor layout (a637006)', '- Fix hold cancel (daff64f)', ''].join(
        '\n',
      ),
    );
    assert.equal(blocks[1]?.type, 'list');
    if (blocks[1]?.type === 'list') {
      assert.equal(blocks[1].items[0]?.[0]?.type, 'text');
      assert.match(blocks[1].items[0]?.[0]?.type === 'text' ? blocks[1].items[0][0].text : '', /^#patch /);
    }
  });

  it('does not turn unsafe urls into links', () => {
    const blocks = parseChangelog('See [docs](javascript:alert(1)) and https://example.com/notes.');
    assert.equal(blocks[0]?.type, 'paragraph');
    if (blocks[0]?.type !== 'paragraph') return;
    assert.equal(
      blocks[0].inlines.some((inline) => inline.type === 'link' && inline.href.startsWith('javascript:')),
      false,
    );
    const link = blocks[0].inlines.find((inline) => inline.type === 'link');
    assert.equal(link?.type === 'link' ? link.href : '', 'https://example.com/notes');
  });
});
