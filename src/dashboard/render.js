import { mdToHtml, escapeHtml as esc, inline } from '../util/md.js';

export const STATUS_META = {
  todo: { label: 'To do', color: '#c3c2b7', dark: '#6b6a66', icon: '○' },
  in_progress: { label: 'In progress', color: '#2a78d6', dark: '#3987e5', icon: '◐' },
  review: { label: 'In review', color: '#ec835a', dark: '#ec835a', icon: '◔' },
  done: { label: 'Done', color: '#0ca30c', dark: '#0ca30c', icon: '●' },
  blocked: { label: 'Blocked', color: '#d03b3b', dark: '#d03b3b', icon: '⊘' },
};
const ORDER = ['done', 'in_progress', 'review', 'blocked', 'todo'];

export function renderDashboard(d) {
  const { state, config, summary: s } = d;
  const title = config.dashboard?.title || state.product?.name || 'Product dashboard';
  const refresh = Number(config.dashboard?.autoRefreshSeconds ?? 30);
  const parts = [];
  parts.push(header(d, title));
  if (state.phase === 'planning' || state.phase === 'init') parts.push(planningStrip(d));
  parts.push(kpis(d));
  if (d.tasks.tasks.length) {
    parts.push(section('charts', 'Progress', `<div class="charts">${donut(d)}${epicBars(d)}${burnup(d)}</div>${chartTables(d)}`));
  }
  const blocked = d.tasks.tasks.filter((t) => t.status === 'blocked');
  if (blocked.length) parts.push(blockedCallout(blocked));
  if (d.tasks.tasks.length) parts.push(taskBoard(d));
  if (d.byEpic.length) parts.push(epicCards(d));
  if (d.roadmap) parts.push(section('roadmap', 'Roadmap and future plans', mdToHtml(d.roadmap)));
  for (const c of d.custom) parts.push(customSection(c));
  if (d.risks) parts.push(section('risks', 'Risks and open questions', mdToHtml(d.risks)));
  if (d.decisions) parts.push(section('decisions', 'Decisions', mdToHtml(d.decisions)));
  if (d.competitors?.length) parts.push(competitorTable(d.competitors));
  if (d.docs.length) parts.push(docsSection(d.docs));
  if (d.log.length) parts.push(activity(d.log));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · dashboard</title>
<style>${CSS}</style>
</head>
<body>
<div class="tip" id="tip" role="tooltip" hidden></div>
<main>
<div class="view-controls"><label>Theme <select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select></label> <label><input id="texture" type="checkbox"> Patterned charts</label></div>
${parts.join('\n')}
<footer>Generated ${esc(d.generatedAt)} by product-planner${refresh > 0 ? ` · auto-refreshes every ${refresh}s` : ''} · regenerate with <code>product-planner dashboard</code></footer>
</main>
<script>${JS}</script>
</body>
</html>`;
}

function section(id, title, body, extra = '') {
  return `<section id="${id}"><div class="sec-head"><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
}
function header(d, title) {
  const { state } = d;
  const phase = state.phase;
  return `<header>
<div>
<h1>${esc(title)}</h1>
${state.product?.tagline ? `<p class="tagline">${esc(state.product.tagline)}</p>` : ''}
${state.product?.summary ? `<p class="summary">${inline(state.product.summary)}</p>` : ''}
</div>
<div class="phase-badge phase-${esc(phase)}"><span class="lbl">Phase</span><span class="val">${esc(phase)}</span></div>
</header>`;
}
function planningStrip(d) {
  const items = d.planningSteps.map(({ step, status }) =>
    `<li class="st-${esc(status)}"><span class="dot"></span>${esc(step)}<small>${esc(status)}</small></li>`).join('');
  return section('planning', 'Planning progress', `<ol class="steps">${items}</ol>`);
}
function kpis(d) {
  const s = d.summary;
  const tiles = [
    ['Progress', `${s.pct}%`, `${s.done} of ${s.total} tasks done`],
    ['In progress', s.in_progress + s.review, `${s.in_progress} active · ${s.review} in review`],
    ['Ready to start', s.ready, 'dependencies satisfied'],
    ['Blocked', s.blocked, s.blocked ? 'needs attention' : 'nothing blocked'],
  ];
  return `<section id="kpis"><div class="tiles">${tiles.map(([l, v, sub]) =>
    `<div class="tile"><div class="tile-l">${esc(l)}</div><div class="tile-v">${esc(v)}</div><div class="tile-s">${esc(sub)}</div></div>`).join('')}</div>
<div class="bar-track" aria-label="overall progress"><div class="bar-fill" style="width:${s.pct}%"></div></div></section>`;
}

/* ---------- charts (inline SVG, palette from the dataviz reference) ---------- */
function legend(keys) {
  return `<ul class="legend">${keys.map((k) => `<li><span class="sw" style="background:${`var(--status-${k})`}"></span>${STATUS_META[k].icon} ${STATUS_META[k].label}</li>`).join('')}</ul>`;
}
function donut(d) {
  const s = d.summary;
  const total = s.total || 1;
  const r = 54, cx = 70, cy = 70, stroke = 16, C = 2 * Math.PI * r;
  let offset = 0;
  const segs = ORDER.filter((k) => s[k] > 0).map((k) => {
    const frac = s[k] / total;
    const len = Math.max(0, frac * C - 2);
    const el = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${`var(--status-${k})`}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" tabindex="0" data-tip="${esc(STATUS_META[k].label)}: ${s[k]} (${Math.round(frac * 100)}%)"><title>${esc(STATUS_META[k].label)}: ${s[k]}</title></circle>`;
    offset += frac * C;
    return el;
  }).join('');
  return `<figure class="chart"><figcaption>Tasks by status</figcaption>
<svg viewBox="0 0 140 140" width="160" height="160" role="img" aria-label="Tasks by status">${segs}
<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="hero">${s.pct}%</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" class="sub">done</text></svg>
${legend(ORDER.filter((k) => s[k] > 0))}</figure>`;
}
function epicBars(d) {
  const groups = d.byEpic.filter((g) => g.tasks.length);
  if (!groups.length) return '';
  const w = 420, rowH = 26, labelW = 150, pad = 8;
  const h = groups.length * rowH + pad * 2;
  const max = Math.max(...groups.map((g) => g.tasks.length));
  const rows = groups.map((g, i) => {
    const y = pad + i * rowH;
    let x = labelW;
    const counts = Object.fromEntries(ORDER.map((k) => [k, g.tasks.filter((t) => t.status === k).length]));
    const segs = ORDER.filter((k) => counts[k]).map((k) => {
      const segW = (counts[k] / max) * (w - labelW - 40);
      const el = `<rect x="${x + 1}" y="${y + 5}" width="${Math.max(segW - 2, 1)}" height="16" rx="3" fill="${`var(--status-${k})`}" tabindex="0" data-tip="${esc(g.epic.title)} · ${STATUS_META[k].label}: ${counts[k]}"><title>${esc(g.epic.title)} · ${STATUS_META[k].label}: ${counts[k]}</title></rect>`;
      x += segW; return el;
    }).join('');
    const done = counts.done, tot = g.tasks.length;
    return `<g><text x="${labelW - 8}" y="${y + 17}" text-anchor="end" class="lab">${esc(truncate(g.epic.title || g.epic.id, 22))}</text>${segs}<text x="${x + 6}" y="${y + 17}" class="val">${done}/${tot}</text></g>`;
  }).join('');
  return `<figure class="chart wide"><figcaption>Tasks per epic</figcaption>
<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Tasks per epic by status">${rows}</svg>${legend(ORDER)}</figure>`;
}
function burnup(d) {
  const pts = d.burnup;
  if (pts.length < 2) return '';
  const w = 420, h = 180, l = 36, r = 12, t = 12, b = 28;
  const maxY = Math.max(1, ...pts.map((p) => p.scope));
  const start = Date.parse(pts[0].date), span = Date.parse(pts.at(-1).date) - start || 1;
  const x = (i) => l + ((Date.parse(pts[i].date) - start) / span) * (w - l - r);
  const y = (v) => t + (1 - v / maxY) * (h - t - b);
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(maxY / 2), maxY].map((v) => `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" class="lab">${v}</text><line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.done)}" r="4" fill="var(--series-1)" class="ring" tabindex="0" data-tip="${p.date}: ${p.done} done of ${p.scope}"><title>${p.date}: ${p.done} done of ${p.scope}</title></circle>`).join('');
  const first = pts[0].date, last = pts.at(-1).date;
  return `<figure class="chart wide"><figcaption>Burn-up (done vs scope)</figcaption>
<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Burn-up chart">${ticks}
<path d="${path('scope')}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-dasharray="4 3"/>
<path d="${path('done')}" fill="none" stroke="var(--series-1)" stroke-width="2"/>${dots}
<line class="crosshair" x1="0" x2="0" y1="${t}" y2="${h - b}" stroke="var(--ink2)" visibility="hidden"/>${pts.map((p, i) => `<rect class="hover-band" x="${Math.max(l, x(i) - 12)}" y="${t}" width="24" height="${h - t - b}" fill="transparent" data-x="${x(i)}" tabindex="0" data-tip="${p.date}: ${p.done} done of ${p.scope}"/>`).join('')}
<text x="${l}" y="${h - 8}" class="lab">${first}</text><text x="${w - r}" y="${h - 8}" text-anchor="end" class="lab">${last}</text></svg>
<ul class="legend"><li><span class="sw" style="background:var(--series-1)"></span>Done (cumulative)</li><li><span class="sw dashed"></span>Scope (total tasks)</li></ul></figure>`;
}

/* ---------- tables and cards ---------- */
function chartTables(d) {
  return `<details><summary>View chart data tables</summary><table><caption>Task counts by status and epic</caption><thead><tr><th>Epic</th>${ORDER.map((k) => `<th>${esc(STATUS_META[k].label)}</th>`).join('')}</tr></thead><tbody>${[{ epic: { title: 'All tasks' }, tasks: d.tasks.tasks }, ...d.byEpic].map((g) => `<tr><td>${esc(g.epic.title)}</td>${ORDER.map((k) => `<td>${g.tasks.filter((t) => t.status === k).length}</td>`).join('')}</tr>`).join('')}</tbody></table>${d.burnup.length ? `<table><caption>Burn-up history</caption><thead><tr><th>Date</th><th>Done</th><th>Scope</th></tr></thead><tbody>${d.burnup.map((p) => `<tr><td>${esc(p.date)}</td><td>${p.done}</td><td>${p.scope}</td></tr>`).join('')}</tbody></table>` : ''}</details>`;
}
function blockedCallout(blocked) {
  return `<section id="blocked" class="callout"><h2>⊘ Blocked tasks need your input</h2><ul>${blocked.map((t) =>
    `<li><strong>${esc(t.id)}</strong> ${esc(t.title)} — ${esc(t.blockedReason || 'no reason given')}</li>`).join('')}</ul></section>`;
}
function taskBoard(d) {
  const epicTitle = new Map(d.tasks.epics.map((e) => [e.id, e.title]));
  const rows = d.tasks.tasks.map((t) => `<tr data-status="${esc(t.status)}" data-search="${esc((t.id + ' ' + t.title + ' ' + (t.description || '') + ' ' + (epicTitle.get(t.epic) || '')).toLowerCase())}">
<td class="mono">${esc(t.id)}</td>
<td><details><summary>${esc(t.title)}</summary><div class="task-detail">${t.description ? mdToHtml(t.description) : ''}${t.acceptance?.length ? `<p class="k">Acceptance</p><ul>${t.acceptance.map((a) => `<li>${inline(a)}</li>`).join('')}</ul>` : ''}${t.dependsOn?.length ? `<p class="k">Depends on: ${t.dependsOn.map(esc).join(', ')}</p>` : ''}${t.blockedReason ? `<p class="k blocked">Blocked: ${esc(t.blockedReason)}</p>` : ''}${t.notes?.length ? `<p class="k">Notes</p><ul>${t.notes.map((n) => `<li><small>${esc((n.ts || '').slice(0, 16).replace('T', ' '))}${n.agent ? ' · ' + esc(n.agent) : ''}</small> ${inline(n.text)}</li>`).join('')}</ul>` : ''}</div></details></td>
<td>${esc(epicTitle.get(t.epic) || t.epic || '')}</td>
<td>${esc(t.agent || '')}</td>
<td><span class="prio prio-${esc(t.priority)}">${esc(t.priority)}</span></td>
<td><span class="status st-${esc(t.status)}"><i style="background:${`var(--status-${t.status})`}"></i>${STATUS_META[t.status]?.icon || ''} ${esc(STATUS_META[t.status]?.label || t.status)}</span></td>
<td class="mono small">${esc((t.completedAt || t.startedAt || '').slice(0, 10))}</td></tr>`).join('');
  const filters = ['all', ...ORDER].map((k) => `<button class="filter${k === 'all' ? ' on' : ''}" data-filter="${k}">${k === 'all' ? 'All' : STATUS_META[k].label} <span class="cnt">${k === 'all' ? d.summary.total : d.summary[k]}</span></button>`).join('');
  return section('tasks', 'Task board', `<table id="task-table"><thead><tr><th>ID</th><th>Task</th><th>Epic</th><th>Agent</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="filters">${filters}<input id="search" aria-label="Search tasks" type="search" placeholder="Search tasks…"></div>`);
}
function epicCards(d) {
  const cards = d.byEpic.map(({ epic, tasks }) => {
    const done = tasks.filter((t) => t.status === 'done').length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return `<div class="card"><div class="card-h"><strong>${esc(epic.id)}</strong> ${esc(epic.title)}</div>${epic.description ? `<p>${inline(epic.description)}</p>` : ''}
<div class="bar-track small"><div class="bar-fill" style="width:${pct}%"></div></div><div class="tile-s">${done}/${tasks.length} done · ${pct}%</div></div>`;
  }).join('');
  return section('epics', 'Epics', `<div class="cards">${cards}</div>`);
}
function customSection(c) {
  let body = '';
  switch (c.type) {
    case 'table': body = `<table><thead><tr>${(c.columns || []).map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${(c.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : Object.values(r)).map((v) => `<td>${inline(String(v ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`; break;
    case 'metrics': body = `<div class="tiles">${(c.metrics || []).map((m) => `<div class="tile"><div class="tile-l">${esc(m.label)}</div><div class="tile-v">${esc(m.value)}</div>${m.note ? `<div class="tile-s">${esc(m.note)}</div>` : ''}</div>`).join('')}</div>`; break;
    case 'list': body = `<ul>${(c.items || []).map((i) => `<li>${inline(String(i))}</li>`).join('')}</ul>`; break;
    case 'bar': body = simpleBars(c.items || []); break;
    default: body = mdToHtml(c.text || c.markdown || '');
  }
  if (c.text && c.type && c.type !== 'text') body += mdToHtml(c.text);
  return section(`custom-${esc(c.file.replace(/\.json$/, ''))}`, c.title || c.file, body);
}
function simpleBars(items) {
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  const w = 420, rowH = 24, labelW = 140;
  const rows = items.map((it, i) => {
    const bw = ((Number(it.value) || 0) / max) * (w - labelW - 60);
    return `<g><text x="${labelW - 8}" y="${8 + i * rowH + 16}" text-anchor="end" class="lab">${esc(truncate(String(it.label), 20))}</text><rect x="${labelW}" y="${8 + i * rowH + 4}" width="${Math.max(bw, 1)}" height="16" rx="3" fill="var(--series-1)" tabindex="0" data-tip="${esc(String(it.label))}: ${esc(String(it.value))}"><title>${esc(String(it.label))}: ${esc(String(it.value))}</title></rect><text x="${labelW + bw + 6}" y="${8 + i * rowH + 16}" class="val">${esc(String(it.value))}</text></g>`;
  }).join('');
  return `<figure class="chart wide"><figcaption>Values by category</figcaption><svg viewBox="0 0 ${w} ${items.length * rowH + 16}" width="100%" role="img">${rows}</svg><details><summary>View data table</summary><table><thead><tr><th>Category</th><th>Value</th></tr></thead><tbody>${items.map((it) => `<tr><td>${esc(it.label)}</td><td>${esc(it.value)}</td></tr>`).join('')}</tbody></table></details></figure>`;
}
function competitorTable(list) {
  const rows = list.map((c) => `<tr><td>${c.url ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</td><td>${esc(c.positioning || c.summary || '')}</td><td>${esc(c.pricing || '')}</td><td><ul>${(c.strengths || c.pros || []).map((x) => `<li>${inline(x)}</li>`).join('')}</ul></td><td><ul>${(c.weaknesses || c.cons || []).map((x) => `<li>${inline(x)}</li>`).join('')}</ul></td></tr>`).join('');
  return section('competitors', 'Competitors', `<table class="comp"><thead><tr><th>Name</th><th>Positioning</th><th>Pricing</th><th>Strengths</th><th>Weaknesses</th></tr></thead><tbody>${rows}</tbody></table>`);
}
function docsSection(docs) {
  return section('docs', 'Planning documents', docs.map((doc) => `<details class="doc"><summary>${esc(doc.title)} <small>${esc(doc.file)}</small></summary><div class="doc-body">${mdToHtml(doc.text)}</div></details>`).join(''));
}
function activity(log) {
  const items = log.slice(-40).reverse().map((e) => {
    const when = esc((e.ts || '').slice(0, 16).replace('T', ' '));
    let text = '';
    if (e.type === 'task') text = `<strong>${esc(e.task)}</strong> ${esc(e.from || 'new')} → ${esc(e.to)}${e.note ? ` · ${esc(e.note)}` : ''}`;
    else text = `${e.message ? inline(e.message) : esc(JSON.stringify(e))}`;
    return `<li><span class="when">${when}</span>${e.agent ? `<span class="who">${esc(e.agent)}</span>` : ''}<span>${text}</span></li>`;
  }).join('');
  return section('activity', 'Activity', `<ul class="activity">${items}</ul>`);
}
function safeUrl(url) { return /^https?:\/\//i.test(url) ? url : '#'; }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

const CSS = `
:root{--series-1:#2a78d6;--series-2:#eb6834;--status-todo:#c3c2b7;--status-in_progress:#2a78d6;--status-review:#ec835a;--status-done:#0ca30c;--status-blocked:#d03b3b;color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--accent:#2a78d6;--good:#0ca30c;--crit:#d03b3b;--warn:#fab219}
:root[data-theme="dark"]{--series-1:#3987e5;--series-2:#d95926;--status-todo:#6b6a66;--status-in_progress:#3987e5;color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--accent:#3987e5}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.view-controls{display:flex;gap:16px;justify-content:flex-end;margin-bottom:16px}.view-controls select{font:inherit;background:var(--surface);color:var(--ink)}
main{max-width:1200px;margin:0 auto;padding:24px 20px 60px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:20px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:0}.tagline{color:var(--ink2);margin:0 0 6px;font-size:17px}.summary{color:var(--ink2);margin:0;max-width:70ch}
.phase-badge{border:1px solid var(--border);background:var(--surface);border-radius:10px;padding:8px 14px;text-align:center;min-width:110px}.phase-badge .lbl{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.phase-badge .val{font-size:18px;font-weight:600;text-transform:capitalize}
.phase-build .val{color:var(--accent)}.phase-done .val{color:var(--good)}
section{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:18px}
.sec-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.tile{border:1px solid var(--border);border-radius:10px;padding:12px 14px}.tile-l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.tile-v{font-size:30px;font-weight:600;line-height:1.2}.tile-s{font-size:12px;color:var(--ink2)}
.bar-track{height:10px;background:var(--grid);border-radius:5px;margin-top:14px;overflow:hidden}.bar-track.small{height:6px;margin-top:8px}.bar-fill{height:100%;background:var(--accent);border-radius:5px;transition:width .3s}
.steps{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}.steps li{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:20px;padding:4px 12px 4px 8px;font-size:13px;text-transform:capitalize}.steps small{color:var(--muted);text-transform:none}
.steps .dot{width:10px;height:10px;border-radius:50%;background:var(--axis)}.steps .st-done .dot{background:var(--good)}.steps .st-in_progress .dot{background:var(--accent)}.steps .st-skipped .dot{background:var(--muted)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:18px;align-items:start}.chart{margin:0;border:1px solid var(--border);border-radius:10px;padding:12px}.chart.wide{grid-column:span 1}
figcaption{font-size:13px;color:var(--ink2);margin-bottom:8px;font-weight:600}
svg text{fill:var(--ink2);font-size:11px}svg .hero{font-size:22px;font-weight:600;fill:var(--ink)}svg .sub{fill:var(--muted)}svg .lab{fill:var(--ink2)}svg .val{fill:var(--ink2);font-variant-numeric:tabular-nums}svg .grid{stroke:var(--grid);stroke-width:1}svg .ring{stroke:var(--surface);stroke-width:2}
.legend{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--ink2)}.legend .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}.legend .sw.dashed{background:none;border-top:2px dashed var(--series-2);height:0}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--axis);padding:8px 8px}td{padding:8px;border-bottom:1px solid var(--grid);vertical-align:top}tr:last-child td{border-bottom:none}
td ul{margin:4px 0;padding-left:18px}.comp td{font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:nowrap}.small{font-size:12px;color:var(--muted)}
details summary{cursor:pointer}.task-detail{padding:8px 0 4px;color:var(--ink2);font-size:13px}.task-detail .k{margin:6px 0 2px;font-weight:600;color:var(--ink)}.task-detail .blocked{color:var(--crit)}
.status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:13px}.status i{width:8px;height:8px;border-radius:50%;display:inline-block}
.prio{font-size:12px;border-radius:4px;padding:1px 6px;border:1px solid var(--border)}.prio-critical{color:var(--crit);border-color:var(--crit)}.prio-high{color:#eb6834;border-color:#eb6834}
.filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.filter{font:inherit;font-size:13px;border:1px solid var(--border);background:transparent;color:var(--ink2);border-radius:20px;padding:4px 10px;cursor:pointer}.filter.on{background:var(--ink);color:var(--surface);border-color:var(--ink)}.filter .cnt{opacity:.7;margin-left:4px}
#search{font:inherit;font-size:13px;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);min-width:180px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.card{border:1px solid var(--border);border-radius:10px;padding:12px}.card p{margin:4px 0;font-size:13px;color:var(--ink2)}
.callout{border-color:var(--crit)}.callout h2{color:var(--crit);margin-bottom:8px}
.doc summary{font-weight:600;padding:8px 0}.doc summary small{color:var(--muted);font-weight:400;margin-left:8px}.doc-body{padding:4px 0 12px;color:var(--ink2);max-width:90ch}.doc-body h1,.doc-body h2,.doc-body h3{color:var(--ink);margin:16px 0 6px;font-size:16px}.doc-body h1{font-size:18px}
.activity{list-style:none;padding:0;margin:0;font-size:13px}.activity li{display:flex;gap:12px;padding:5px 0;border-bottom:1px solid var(--grid)}.activity .when{color:var(--muted);font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap}.activity .who{color:var(--accent);white-space:nowrap}
pre{background:var(--page);border:1px solid var(--border);border-radius:8px;padding:10px;overflow:auto;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}blockquote{border-left:3px solid var(--axis);margin:8px 0;padding:2px 12px;color:var(--ink2)}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:30px}
.pattern-overlay{display:none}.textured .pattern-overlay{display:initial}@media print,(forced-colors:active){.pattern-overlay{display:initial}}
.tip{max-width:220px;position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);font-size:12px;padding:4px 8px;border-radius:6px;z-index:10}
@media(max-width:700px){header{flex-direction:column}td,th{padding:6px 4px}}
`;
const JS = `
(function(){
var theme=document.getElementById('theme');
try{theme.value=localStorage.getItem('pp-theme')||'light';}catch(e){}
document.documentElement.dataset.theme=theme.value;
theme.addEventListener('change',function(){document.documentElement.dataset.theme=theme.value;try{localStorage.setItem('pp-theme',theme.value);}catch(e){}});
// Opt-in pattern overlays retain the status fill and add a non-color channel.
document.querySelectorAll('svg').forEach(function(svg,i){var ns='http://www.w3.org/2000/svg';var defs=document.createElementNS(ns,'defs');defs.innerHTML='<pattern id="pp-lines-'+i+'" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="1" opacity=".45"/></pattern>';svg.prepend(defs);svg.querySelectorAll('rect[data-tip]:not(.hover-band),circle[data-tip]').forEach(function(mark){var clone=mark.cloneNode(false);clone.removeAttribute('data-tip');clone.removeAttribute('tabindex');clone.setAttribute('aria-hidden','true');clone.setAttribute(mark.tagName==='circle'?'stroke':'fill','url(#pp-lines-'+i+')');clone.setAttribute('class','pattern-overlay');clone.style.pointerEvents='none';mark.after(clone);});});
document.querySelectorAll('.hover-band').forEach(function(band){function show(){var line=band.closest('svg').querySelector('.crosshair');line.setAttribute('x1',band.dataset.x);line.setAttribute('x2',band.dataset.x);line.setAttribute('visibility','visible');}function hide(){band.closest('svg').querySelector('.crosshair').setAttribute('visibility','hidden');}band.addEventListener('mouseenter',show);band.addEventListener('focus',show);band.addEventListener('mouseleave',hide);band.addEventListener('blur',hide);});
document.getElementById('texture').addEventListener('change',function(e){document.body.classList.toggle('textured',e.target.checked);});
var tip=document.getElementById('tip');
document.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.hidden=true;return;}tip.textContent=t.getAttribute('data-tip');tip.hidden=false;tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';});
document.addEventListener('focusin',function(e){var t=e.target.closest('[data-tip]');if(t){var r=t.getBoundingClientRect();tip.textContent=t.dataset.tip;tip.hidden=false;tip.style.left=Math.min(r.left,window.innerWidth-220)+'px';tip.style.top=(r.bottom+6)+'px';}});document.addEventListener('focusout',function(){tip.hidden=true;});
var rows=[].slice.call(document.querySelectorAll('#task-table tbody tr')),filter='all',q='';
function apply(){rows.forEach(function(r){var ok=(filter==='all'||r.dataset.status===filter)&&(!q||r.dataset.search.indexOf(q)>=0);r.style.display=ok?'':'none';});}
document.querySelectorAll('.filter').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.filter').forEach(function(x){x.classList.remove('on')});b.classList.add('on');filter=b.dataset.filter;apply();});});
var s=document.getElementById('search');if(s){s.addEventListener('input',function(){q=s.value.toLowerCase();apply();});}
try{var y=sessionStorage.getItem('pp-scroll');if(y)window.scrollTo(0,+y);window.addEventListener('scroll',function(){sessionStorage.setItem('pp-scroll',window.scrollY);});}catch(e){}
})();`;
