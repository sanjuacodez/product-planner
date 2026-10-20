// Reference implementation used only to validate the hidden tests.
import fs from 'node:fs';
const file = 'todos.json';
const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { next: 1, todos: [] });
const save = (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2));
const die = (m) => { console.error(m); process.exit(1); };
const [cmd, arg] = process.argv.slice(2);
const d = load();
const find = () => { const t = d.todos.find((x) => x.id === Number(arg)); if (!t) die(`Unknown id: ${arg}`); return t; };
if (cmd === 'add') { if (!arg || !arg.trim()) die('Missing text'); const t = { id: d.next++, text: arg, done: false }; d.todos.push(t); save(d); console.log(`Added ${t.id}: ${t.text}`); }
else if (cmd === 'list') { const list = d.todos.filter((t) => arg !== '--pending' || !t.done); console.log(list.length ? list.map((t) => `${t.id} [${t.done ? 'x' : ' '}] ${t.text}`).join('\n') : 'No todos'); }
else if (cmd === 'done') { find().done = true; save(d); console.log(`Done ${arg}`); }
else if (cmd === 'remove') { const t = find(); d.todos = d.todos.filter((x) => x !== t); save(d); console.log(`Removed ${arg}`); }
else die(`Unknown command: ${cmd}`);
