/** Minimal GitHub-flavoured markdown to HTML (headings, lists, tables, code, inline). */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function inline(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}
export function mdToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const listStack = [];
  const closeLists = (depth = 0) => { while (listStack.length > depth) out.push(`</${listStack.pop()}>`); };
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      closeLists();
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeLists(); out.push('<hr>'); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-+/.test(lines[i + 1])) {
      closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      while (listStack.length > depth) out.push(`</${listStack.pop()}>`);
      while (listStack.length < depth) { out.push(`<${tag}>`); listStack.push(tag); }
      let text = li[3];
      const cb = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (cb) text = `<input type="checkbox" disabled${cb[1] !== ' ' ? ' checked' : ''}> ${cb[2]}`;
      out.push(`<li>${cb ? text.replace(/^(<input[^>]*>) (.*)$/, (m, a, b) => a + ' ' + inline(b)) : inline(text)}</li>`);
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (!line.trim()) { closeLists(); i++; continue; }
    closeLists();
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||\s*([-*+]|\d+[.)])\s|>)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  closeLists();
  return out.join('\n');
}
