import type { ReactNode } from 'react';
import {
  parseChangelog,
  type ChangelogInline,
} from '../changelogMarkdown';

function renderInlines(inlines: ChangelogInline[], keyPrefix: string): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}-${index}`;
    if (inline.type === 'strong') return <strong key={key}>{inline.text}</strong>;
    if (inline.type === 'code') return <code key={key}>{inline.text}</code>;
    if (inline.type === 'link') {
      return (
        <a key={key} href={inline.href} target="_blank" rel="noreferrer noopener">
          {inline.text}
        </a>
      );
    }
    return <span key={key}>{inline.text}</span>;
  });
}

function fullChangelogHref(inlines: ChangelogInline[]): string | null {
  const labeled = inlines.some(
    (inline) => inline.type === 'strong' && /full changelog/i.test(inline.text),
  );
  if (!labeled) return null;
  for (let i = inlines.length - 1; i >= 0; i -= 1) {
    const inline = inlines[i];
    if (inline?.type === 'link') return inline.href;
  }
  return null;
}

/** Renders release-notes markdown as headings, bullets, and links. */
export function ChangelogView({ markdown }: { markdown: string }) {
  const blocks = parseChangelog(markdown);
  if (blocks.length === 0) return null;

  return (
    <div className="changelog">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = block.level === 2 ? 'h2' : 'h3';
          return (
            <Tag key={index} className={`changelog__h${block.level}`}>
              {renderInlines(block.inlines, `h${index}`)}
            </Tag>
          );
        }

        if (block.type === 'list') {
          return (
            <ul key={index} className="changelog__list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <span className="changelog__mark" aria-hidden />
                  <span>{renderInlines(item, `li${index}-${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        const compareHref = fullChangelogHref(block.inlines);
        if (compareHref) {
          return (
            <p key={index} className="changelog__compare">
              <a href={compareHref} target="_blank" rel="noreferrer noopener">
                Full changelog
              </a>
            </p>
          );
        }

        return (
          <p key={index} className="changelog__p">
            {renderInlines(block.inlines, `p${index}`)}
          </p>
        );
      })}
    </div>
  );
}
