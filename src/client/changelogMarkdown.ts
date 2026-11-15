export type ChangelogInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type ChangelogBlock =
  | { type: 'heading'; level: 2 | 3; inlines: ChangelogInline[] }
  | { type: 'list'; items: ChangelogInline[][] }
  | { type: 'paragraph'; inlines: ChangelogInline[] };

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function trimTrailingPunct(raw: string): string {
  let end = raw.length;
  while (end > 0 && /[),.;:!?\]>]/.test(raw[end - 1] ?? '')) end -= 1;
  return raw.slice(0, end);
}

export function parseChangelogInlines(input: string): ChangelogInline[] {
  const out: ChangelogInline[] = [];
  let text = '';
  let i = 0;

  const flush = () => {
    if (!text) return;
    out.push({ type: 'text', text });
    text = '';
  };

  while (i < input.length) {
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push({ type: 'strong', text: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (input[i] === '[') {
      const match = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(input.slice(i));
      const href = match ? safeHref(match[2] ?? '') : null;
      if (match && href) {
        flush();
        out.push({ type: 'link', text: match[1] ?? href, href });
        i += match[0].length;
        continue;
      }
    }

    if (input.startsWith('http://', i) || input.startsWith('https://', i)) {
      const match = /^https?:\/\/[^\s<>]+/.exec(input.slice(i));
      if (match) {
        const visible = trimTrailingPunct(match[0]);
        const href = safeHref(visible);
        if (href) {
          flush();
          out.push({ type: 'link', text: visible, href });
          i += visible.length;
          continue;
        }
      }
    }

    text += input[i];
    i += 1;
  }

  flush();
  return out;
}

export function parseChangelog(markdown: string): ChangelogBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ChangelogBlock[] = [];
  let list: ChangelogInline[][] | null = null;
  let paragraph: string[] = [];

  const flushList = () => {
    if (list && list.length > 0) blocks.push({ type: 'list', items: list });
    list = null;
  };

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (!text) return;
    const inlines = parseChangelogInlines(text);
    if (inlines.length > 0) blocks.push({ type: 'paragraph', inlines });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      const marks = heading[1] ?? '##';
      blocks.push({
        type: 'heading',
        level: marks.length >= 3 ? 3 : 2,
        inlines: parseChangelogInlines((heading[2] ?? '').trim()),
      });
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const item = parseChangelogInlines((bullet[1] ?? '').trim());
      if (item.length === 0) continue;
      if (!list) list = [];
      list.push(item);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}
