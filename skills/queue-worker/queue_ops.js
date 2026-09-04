#!/usr/bin/env node
/**
 * queue_ops.js — Queue Dispatcher helper  (v0.2, instance-agnostic + batch-aware)
 *
 * DESIGN GOALS
 *  - INSTANCE-AGNOSTIC: no hardcoded paths. Every location comes from a config
 *    file (--config) or explicit CLI args. Runs identically on any Coworker/OpenWorker
 *    instance. The skill + scaffolds supply the paths at runtime.
 *  - BATCH-AWARE: rows may carry a `Batch` tag. Dispatch prefers CONTINUING an
 *    in-progress batch over starting a new one, so a session keeps working through
 *    its allotted batch instead of jumping between unrelated tasks.
 *  - SAFE WRITES: atomic replace (temp file + fs.renameSync, atomic on NTFS/POSIX).
 *    Re-reads the file immediately before every write. Bounded foreground process:
 *    one command, one exit. No daemon, no watcher.
 *
 * CONFIG (preferred): --config PATH  -> JSON:
 *   {
 *     "queue":       "<path to Job queue.csv>",
 *     "control":     "<path to dispatcher-control.json>",
 *     "feed":        "<path to Flags.csv>",
 *     "commonFlags": "<path to COMMON_FLAGS.md>",   // optional, informational
 *     "activeLimit": 2
 *   }
 * Individual overrides: --queue --control --feed --limit
 * If neither --config nor --queue is given, defaults to ./dispatcher-config.json.
 *
 * COMMANDS
 *   status                          Control state, active count, eligible/batched/parked/recon
 *   dispatch [--note TEXT]          Dispatch PENDING rows up to the active limit (batch-aware)
 *   next --session NAME             Show the next task a session should run (batch continuation)
 *   set --id N --flag FLAG          Set Flags on queue row N
 *   set --id N --update TEXT        Append a timestamped check-in to Update on the task
 *   set --id N --dcomment TEXT      Append a timestamped note to Comments from Dispatcher
 *   park --id N --question TEXT     BLOCKED_USER: question -> Update, note -> Dispatcher comments
 *   reconcile [--stale-hours H]     Flag orphaned DISPATCHED/RUNNING rows NEEDS_RECONCILIATION
 *   control get | control set STATE [note]
 *   feed review                     Read-only report of Flags.csv (state flags vs job proposals)
 *   feed accept --feed-id N [--queue-fields ...]   Create queue row + mark feed ACCEPTED
 *   feed reject --feed-id N --reason TEXT         Mark feed REJECTED / DUPLICATE
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- arg parsing ----------
const argv = process.argv.slice(2);
function opt(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; }
const hasOpt = (name) => argv.includes('--' + name);
const command = argv[0];
const sub = argv[1];

// ---------- config resolution (instance-agnostic) ----------
function loadConfig() {
  let cfg = {};
  const cfgPath = opt('config', 'dispatcher-config.json');
  if (fs.existsSync(path.resolve(cfgPath))) {
    try { cfg = JSON.parse(fs.readFileSync(path.resolve(cfgPath), 'utf8')); }
    catch (e) { die('config corrupt (' + cfgPath + '): ' + e.message); }
  } else if (!hasOpt('queue')) {
    die('no config found at ' + cfgPath + ' and no --queue given. Pass --config or --queue.');
  }
  return {
    queue: path.resolve(opt('queue', cfg.queue || 'Job queue.csv')),
    control: path.resolve(opt('control', cfg.control || 'dispatcher-control.json')),
    feed: path.resolve(opt('feed', cfg.feed || 'Flags.csv')),
    commonFlags: cfg.commonFlags ? path.resolve(cfg.commonFlags) : null,
    limit: Number(opt('limit', cfg.activeLimit != null ? cfg.activeLimit : 2)),
  };
}
const CFG = loadConfig();

const FLAGS = ['PENDING','DISPATCHED','RUNNING','QA_PENDING','COMPLETE','BLOCKED_USER','FAILED','SKIP','PAUSED','PAUSED_KILL_SWITCH','NEEDS_RECONCILIATION'];
const ACTIVE_FLAGS = new Set(['DISPATCHED','RUNNING']);
const OPEN_FLAGS = new Set(['PENDING','DISPATCHED','RUNNING','QA_PENDING']);
const CONTROL_STATES = ['ACTIVE','PAUSED','KILL_SWITCHED'];

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}
function esc(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function serialize(rows) { return rows.map(r => r.map(esc).join(',')).join('\n') + '\n'; }

function readTable(file) {
  if (!fs.existsSync(file)) die('file not found: ' + file);
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  if (!rows.length) die('file empty: ' + file);
  const header = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(r => { const o = {}; header.forEach((h, i) => o[h] = r[i] != null ? r[i] : ''); return o; });
  return { header, data };
}
function writeAtomic(file, header, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, serialize([header, ...data.map(o => header.map(h => o[h]))]), 'utf8');
  fs.renameSync(tmp, file);
}
function readQueue() { return readTable(CFG.queue); }
function writeQueue(header, data) { writeAtomic(CFG.queue, header, data); }
function readFeed() { return readTable(CFG.feed); }
function writeFeed(header, data) { writeAtomic(CFG.feed, header, data); }

// ---------- control file ----------
function readControl() {
  if (!fs.existsSync(CFG.control)) return { state: 'ACTIVE', updated: null, note: '(control file missing — treated as ACTIVE)' };
  try { return JSON.parse(fs.readFileSync(CFG.control, 'utf8')); } catch (e) { die('control file corrupt: ' + e.message); }
}
function writeControl(state, note) {
  const prev = readControl();
  const obj = { state, updated: new Date().toISOString(), note: note || prev.note || '' };
  const tmp = CFG.control + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CFG.control);
  return obj;
}

// ---------- helpers ----------
function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }
function byId(data, id) { const r = data.find(r => String(r['Queue #']).trim() === String(id)); if (!r) die('no row with Queue #' + id); return r; }
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z'; }
function effFlag(r) { return (r['Flags'] || '').trim() || 'PENDING'; }
function batchOf(r) { if ((r['Batch'] || '').trim()) return r['Batch'].trim(); const m = (r['Task list'] || '').match(/^\[([^\]]+)\]/); return m ? m[1] : ''; }
function printRows(label, rows) { console.log(label + ':'); if (!rows.length) console.log('  (none)'); for (const r of rows) console.log(`  #${r['Queue #']}  [${effFlag(r)}]${r['Batch'] ? '  {'+r['Batch']+'}' : ''}  ${r['Task list'] || '(no task text)'}`); }
function appendField(r, field, text) { const prev = (r[field] || '').trim(); r[field] = (prev ? prev + '\n' : '') + `[${stamp()}] ` + text; }

// ---------- commands ----------
if (command === 'control') {
  if (sub === 'get') console.log(JSON.stringify(readControl(), null, 2));
  else if (sub === 'set') { const s = argv[2]; if (!CONTROL_STATES.includes(s)) die('state must be ' + CONTROL_STATES.join('|')); console.log(JSON.stringify(writeControl(s, argv[3] || ''), null, 2)); }
  else die('usage: control get | control set STATE [note]');
}
else if (command === 'status') {
  const ctl = readControl();
  const { data } = readQueue();
  const active = data.filter(r => ACTIVE_FLAGS.has(effFlag(r)));
  const eligible = data.filter(r => effFlag(r) === 'PENDING' && (r['Task list'] || '').trim());
  const activeBatches = [...new Set(active.map(batchOf).filter(Boolean))];
  console.log(`control: ${ctl.state}   (limit ${CFG.limit})`);
  console.log(`active (${active.length}/${CFG.limit}):`);
  for (const r of active) console.log(`  #${r['Queue #']}  [${effFlag(r)}]${r['Batch'] ? '  {'+r['Batch']+'}' : ''}  ${r['Session Name']||''}  ${r['Task list']||''}`);
  if (activeBatches.length) console.log('in-progress batches: ' + activeBatches.join(', '));
  printRows(`eligible PENDING (${eligible.length})`, eligible);
  printRows('parked BLOCKED_USER', data.filter(r => effFlag(r) === 'BLOCKED_USER'));
  printRows('needs reconciliation', data.filter(r => effFlag(r) === 'NEEDS_RECONCILIATION'));
}
else if (command === 'dispatch') {
  const ctl = readControl();
  if (ctl.state !== 'ACTIVE') die(`control state is ${ctl.state} — no dispatch allowed`);
  const { header, data } = readQueue();
  const active = data.filter(r => ACTIVE_FLAGS.has(effFlag(r)));
  const slots = Math.max(0, CFG.limit - active.length);
  if (slots === 0) { console.log(`no slots free (active=${active.length}/${CFG.limit}) — nothing dispatched`); process.exit(0); }
  const activeBatches = new Set(active.map(batchOf).filter(Boolean));
  const eligible = data
    .filter(r => effFlag(r) === 'PENDING' && (r['Task list'] || '').trim())
    .sort((a, b) => Number(a['Queue #']) - Number(b['Queue #']));
  // batch-aware: continue in-progress batches first, then start new ones (lowest Queue # within each group)
  const cont = eligible.filter(r => activeBatches.has(batchOf(r)));
  const fresh = eligible.filter(r => !activeBatches.has(batchOf(r)));
  const chosen = [...cont, ...fresh].slice(0, slots);
  const note = opt('note', '');
  for (const r of chosen) {
    r['Flags'] = 'DISPATCHED';
    appendField(r, 'Comments from Dispatcher', `DISPATCHED (slot ${active.length + 1}/${CFG.limit})${r['Batch'] ? ' batch=' + r['Batch'] : ''}${note ? ' — ' + note : ''}`);
  }
  writeQueue(header, data);
  console.log(`dispatched ${chosen.length} row(s): ${chosen.map(r => '#' + r['Queue #'] + (r['Batch'] ? '{' + r['Batch'] + '}' : '')).join(', ')}`);
  console.log('Handoff payloads must now be carried into the named worker sessions.');
}
else if (command === 'next') {
  // worker self-pull aid: show the next task a session should run (batch continuation preferred)
  const sess = opt('session'); if (!hasOpt('session')) die('--session required');
  const { data } = readQueue();
  const mine = data.find(r => (r['Session Name'] || '').trim() === sess && ACTIVE_FLAGS.has(effFlag(r)));
  const myBatch = mine ? batchOf(mine) : '';
  const pool = data.filter(r => effFlag(r) === 'PENDING' && (r['Task list'] || '').trim())
    .sort((a, b) => Number(a['Queue #']) - Number(b['Queue #']));
  const pick = (myBatch && pool.find(r => batchOf(r) === myBatch)) || pool.find(r => (r['Session Name'] || '').trim() === sess) || pool[0] || null;
  if (!pick) { console.log('no pending tasks for ' + sess); process.exit(0); }
  console.log(`NEXT for ${sess}: #${pick['Queue #']}${pick['Batch'] ? ' {'+pick['Batch']+'}' : ''} — ${pick['Task list']}`);
  console.log(`destination: ${pick['Destination folder /link'] || '(none)'}`);
  console.log(`skill: ${pick['Skill'] || '(none)'}   QA: ${pick['QA'] || 'no'}`);
}
else if (command === 'set') {
  const id = opt('id'); if (!hasOpt('id')) die('--id required');
  const { header, data } = readQueue();
  const r = byId(data, id);
  if (hasOpt('flag')) { const f = opt('flag').toUpperCase(); if (!FLAGS.includes(f)) die('unknown flag ' + f); r['Flags'] = f; }
  if (hasOpt('update')) appendField(r, 'Update on the task', opt('update'));
  if (hasOpt('dcomment')) appendField(r, 'Comments from Dispatcher', opt('dcomment'));
  writeQueue(header, data);
  console.log(`row #${id}: Flags=${r['Flags'] || '(blank)'}`);
}
else if (command === 'park') {
  const id = opt('id'); if (!hasOpt('id') || !hasOpt('question')) die('--id and --question required');
  const { header, data } = readQueue();
  const r = byId(data, id);
  const wasActive = ACTIVE_FLAGS.has(effFlag(r));
  r['Flags'] = 'BLOCKED_USER';
  appendField(r, 'Update on the task', 'QUESTION FOR USER: ' + opt('question'));
  appendField(r, 'Comments from Dispatcher', `Parked pending user response. Slot released${wasActive ? ' (was active)' : ''}. No redispatch until User comments answered.`);
  writeQueue(header, data);
  console.log(`row #${id} parked BLOCKED_USER; slot released=${wasActive}`);
}
else if (command === 'reconcile') {
  const hours = Number(opt('stale-hours', '24'));
  const { header, data } = readQueue();
  const now = Date.now(); const flagged = [];
  for (const r of data) {
    if (!ACTIVE_FLAGS.has(effFlag(r))) continue;
    const upd = r['Update on the task'] || '';
    const m = upd.match(/\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})Z\]/g);
    const lastTs = m && m.length ? Date.parse(m[m.length - 1].slice(1, -1).replace(' ', 'T') + 'Z') : NaN;
    if (isNaN(lastTs) || (now - lastTs) > hours * 3600e3) {
      const was = effFlag(r); r['Flags'] = 'NEEDS_RECONCILIATION';
      appendField(r, 'Comments from Dispatcher', `Reconciled: was ${was} with no recent check-in (> ${hours}h or none). Awaiting user decision in User comments.`);
      flagged.push('#' + r['Queue #']);
    }
  }
  if (flagged.length) writeQueue(header, data);
  console.log(flagged.length ? `flagged NEEDS_RECONCILIATION: ${flagged.join(', ')}` : 'no stale active rows');
}
else if (command === 'feed') {
  const { header, data } = readFeed();
  if (sub === 'review') {
    const open = data.filter(r => !(r['Feed Status'] || '').trim() || (r['Feed Status'] || '').trim() === 'PROPOSED');
    const states = open.filter(r => (r['Task'] || '').startsWith('STATE FLAG:'));
    const jobs = open.filter(r => !(r['Task'] || '').startsWith('STATE FLAG:'));
    console.log(`FLAGS.CSV REVIEW — ${open.length} open row(s): ${states.length} state flag(s), ${jobs.length} job proposal(s)`);
    console.log('\nSTATE FLAGS (check-ins — report only, never dispatch):');
    for (const r of states) console.log(`  Feed #${r['Feed #']}  ${r['Source Session']}  ::  ${r['Task']}`);
    console.log('\nJOB PROPOSALS (candidates for the queue):');
    for (const r of jobs) console.log(`  Feed #${r['Feed #']}  [${r['Mode']||'ASYNC'}]  ${r['Source Session']}  ::  ${r['Task']}  -> target=${r['Target Session']||'(assign)'} skill=${r['Skill']||'-'} qa=${r['QA']||'no'}`);
    const stale = open.filter(r => { const t = Date.parse((r['Submitted']||'').replace(' ','T')); return !isNaN(t) && (Date.now()-t) > 7*86400e3; });
    if (stale.length) console.log('\nSTALE (>7d) — user decision: ' + stale.map(r=>'#'+r['Feed #']).join(', '));
  }
  else if (sub === 'accept') {
    const fid = opt('feed-id'); if (!hasOpt('feed-id')) die('--feed-id required');
    const q = readQueue();
    const fr = data.find(r => String(r['Feed #']).trim() === String(fid)); if (!fr) die('no feed row #' + fid);
    if (!(fr['Task'] || '').trim()) { fr['Feed Status'] = 'REJECTED'; fr['Review Note'] = `[${stamp()}] rejected: empty Task`; writeFeed(header, data); die('rejected: empty Task'); }
    const dup = q.data.find(r => OPEN_FLAGS.has(effFlag(r)) && (r['Task list']||'').trim() === (fr['Task']||'').trim());
    if (dup) { fr['Feed Status'] = 'DUPLICATE'; fr['Queue Ref'] = dup['Queue #']; fr['Review Note'] = `[${stamp()}] duplicate of queue #${dup['Queue #']}`; writeFeed(header, data); die('duplicate of queue #' + dup['Queue #']); }
    const maxQ = q.data.reduce((m, r) => Math.max(m, parseInt(r['Queue #'], 10) || 0), 0);
    const newRow = {}; q.header.forEach(h => newRow[h] = '');
    newRow['Queue #'] = String(maxQ + 1);
    newRow['Task list'] = fr['Task'];
    newRow['Session Name'] = fr['Target Session'] || '';
    newRow['Skill'] = fr['Skill'] || '';
    newRow['QA'] = fr['QA'] || '';
    newRow['Destination folder /link'] = fr['Destination'] || '';
    if (q.header.includes('Batch')) newRow['Batch'] = (fr['Context']||'').match(/batch[:=]\s*([A-Za-z0-9._-]+)/i)?.[1] || '';
    newRow['Flags'] = 'PENDING';
    appendField(newRow, 'Comments from Dispatcher', `[intake: Flags.csv Feed #${fid}] accepted${fr['Context'] ? ' | ctx: ' + fr['Context'] : ''}`);
    q.data.push(newRow);
    writeQueue(q.header, q.data);
    fr['Feed Status'] = 'ACCEPTED'; fr['Queue Ref'] = newRow['Queue #']; fr['Review Note'] = `[${stamp()}] accepted -> queue #${newRow['Queue #']}`;
    writeFeed(header, data);
    console.log(`accepted feed #${fid} -> queue #${newRow['Queue #']}`);
  }
  else if (sub === 'reject') {
    const fid = opt('feed-id'); const reason = opt('reason', 'rejected by dispatcher');
    const fr = data.find(r => String(r['Feed #']).trim() === String(fid)); if (!fr) die('no feed row #' + fid);
    fr['Feed Status'] = (reason.toLowerCase().includes('dup') ? 'DUPLICATE' : 'REJECTED');
    fr['Review Note'] = `[${stamp()}] ${reason}`;
    writeFeed(header, data);
    console.log(`feed #${fid} marked ${fr['Feed Status']}`);
  }
  else die('usage: feed review | feed accept --feed-id N | feed reject --feed-id N --reason TEXT');
}
else die('unknown command ' + (command || '(none)') + ' — use: status | dispatch | next | set | park | reconcile | control | feed');
