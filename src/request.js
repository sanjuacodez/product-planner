import path from 'node:path';
import { stateDir } from './state.js';
import { readText } from './util/fs.js';

/** Request statements with stable ids (R1, R2, …) in document order: one per paragraph,
 * or one per list item when a paragraph is a list. Headings and comments are dropped. */
export function requestItems(cwd) {
  const text = readText(path.join(stateDir(cwd), 'request.md'), '').replace(/<!--[\s\S]*?-->/g, '');
  const items = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
    if (!lines.length) continue;
    const list = /^\s*(?:[-+*]|\d+[.)])\s+/;
    if (lines.some((l) => list.test(l))) {
      let current = null;
      for (const line of lines) {
        if (list.test(line)) { if (current) items.push(current); current = line.replace(list, '').trim(); }
        else if (current) current += ' ' + line.trim();
        else items.push(line.trim());
      }
      if (current) items.push(current);
    } else items.push(lines.map((l) => l.trim()).join(' '));
  }
  const seen = new Set();
  return items.filter((t) => t && !seen.has(t) && seen.add(t)).map((text, i) => ({ id: `R${i + 1}`, text }));
}
