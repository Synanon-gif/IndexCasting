export type GermanLegalBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

/** Minimal markdown subset for German legal docs (headings, paragraphs, bullet lists). */
export function parseGermanLegalMarkdown(markdown: string): GermanLegalBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: GermanLegalBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ type: 'p', text });
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ type: 'ul', items: bullets });
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
      continue;
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph();
      bullets.push(trimmed.slice(2).trim());
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      flushBullets();
      continue;
    }
    flushBullets();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushBullets();
  return blocks;
}
