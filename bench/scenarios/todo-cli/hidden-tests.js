// Hidden acceptance tests for todo-cli. Checks only behaviour stated in prompt.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.env.BENCH_TARGET || path.join(process.cwd(), 'todo.js');
function cli(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-hidden-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return (...args) => { const r = spawnSync(process.execPath, [target, ...args], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
}
test('empty list', (t) => { const run = cli(t); assert.deepEqual([run('list').out, run('list').code], ['No todos', 0]); });
test('add prints the new id and text', (t) => { const run = cli(t); assert.equal(run('add', 'Buy milk').out, 'Added 1: Buy milk'); assert.equal(run('add', 'Call Sam').out, 'Added 2: Call Sam'); });
test('list shows todos in id order with done markers', (t) => { const run = cli(t); run('add', 'A'); run('add', 'B'); assert.equal(run('done', '1').out, 'Done 1'); assert.equal(run('list').out, '1 [x] A\n2 [ ] B'); });
test('list --pending hides done todos', (t) => { const run = cli(t); run('add', 'A'); run('add', 'B'); run('done', '1'); assert.equal(run('list', '--pending').out, '2 [ ] B'); });
test('remove deletes and ids are never reused', (t) => { const run = cli(t); run('add', 'A'); run('add', 'B'); assert.equal(run('remove', '2').out, 'Removed 2'); assert.equal(run('add', 'C').out, 'Added 3: C'); assert.equal(run('list').out, '1 [ ] A\n3 [ ] C'); });
test('todos persist in todos.json', (t) => { const run = cli(t); run('add', 'Persist me'); assert.equal(run('list').out, '1 [ ] Persist me'); });
test('unknown ids fail with exit code 1 and a stderr message', (t) => { const run = cli(t); for (const args of [['done', '9'], ['remove', '9']]) { const r = run(...args); assert.equal(r.code, 1); assert.ok(r.err.length > 0); } });
test('missing text and unknown commands fail with exit code 1', (t) => { const run = cli(t); for (const args of [['add'], ['frobnicate']]) { const r = run(...args); assert.equal(r.code, 1); assert.ok(r.err.length > 0); } });
