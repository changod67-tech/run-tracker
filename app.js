import { parsePlan, iso, fromIso, addDays, uid } from './plan.js';
import { SEED_NAME, SEED_PLAN } from './seed.js';
import * as strava from './strava.js';

const KEY = 'run-tracker';
const $ = s => document.querySelector(s);
const main = $('main');
const sheet = $('#sheet');
const params = new URLSearchParams(location.search);
const today = () => params.get('today') || iso(new Date()); // ?today=2026-11-11 previews another day
const fmt = (s, o = { weekday: 'short', month: 'short', day: 'numeric' }) => fromIso(s).toLocaleDateString('en-US', o);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  dot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/></svg>',
};
const STATUS = { done: 'Done', skipped: 'Skipped' };

// ---------- state ----------
let state = load();
let selected = null; // date picked in the week strip; null = today

function newPlan(name, text) {
  return { id: uid(), name, weeks: parsePlan(text) };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.plans) return s;
  } catch {}
  const p = newPlan(SEED_NAME, SEED_PLAN);
  return { plans: [p], activeId: p.id, strava: {} };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('Couldn’t save on this phone. Save a backup from Plans.');
  }
}

const plan = () => state.plans.find(p => p.id === state.activeId) ?? state.plans[0];
const runs = p => p.weeks.flatMap(w => w.days).sort((a, b) => a.date.localeCompare(b.date));
const weekOf = (p, date) => p.weeks.find(w => date >= w.start && date <= addDays(w.start, 6));
const findRun = id => {
  for (const p of state.plans) for (const w of p.weeks) {
    const d = w.days.find(d => d.id === id);
    if (d) return { p, w, d };
  }
};

// ---------- shared bits ----------
function splitDistance(s) {
  const m = s.match(/^([\d.]+(?:\s*[–-]\s*[\d.]+)?)\s*(.*)$/);
  return m ? [m[1].replace(/\s*[–-]\s*/, '–'), m[2]] : [s, ''];
}

function statusMark(d) {
  if (!d) return '';
  const icon = d.status === 'done' ? ICON.check : d.status === 'skipped' ? ICON.x : ICON.dot;
  return `<span class="mark">${icon}</span>`;
}

function weekProgress(w) {
  const done = w.days.filter(d => d.status === 'done').length;
  return { done, n: w.days.length, pct: w.days.length ? Math.round((done / w.days.length) * 100) : 0 };
}

function header(eyebrow, title, sub = '') {
  return `<header class="top">
    <p class="eyebrow">${eyebrow}</p>
    <h1 class="title">${title}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
  </header>`;
}

// ---------- Today ----------
function viewToday() {
  const p = plan();
  if (!p) return emptyState();
  const t = today();
  const sel = selected ?? t;
  const all = runs(p);
  const first = all[0]?.date, last = all.at(-1)?.date;
  const run = all.find(d => d.date === sel);
  const wk = weekOf(p, sel) ?? (sel < p.weeks[0].start ? p.weeks[0] : p.weeks.at(-1));
  const title = sel === t ? 'Today' : fmt(sel, { weekday: 'long' });

  let card;
  if (run) card = workoutCard(run, wk);
  else if (!first || sel < first) card = infoCard('Plan starts soon', countdown(sel, p.weeks[0].start), all[0]);
  else if (sel > last) card = completeCard(all);
  else card = infoCard('Rest day', 'Recovery is part of the plan.', all.find(d => d.date > sel));

  return header(fmt(sel, { weekday: 'long', month: 'long', day: 'numeric' }), title)
    + card + weekStrip(p, wk, sel, t);
}

function countdown(from, start) {
  const days = Math.round((fromIso(start) - fromIso(from)) / 864e5);
  return `${esc(plan().name)} begins ${days === 1 ? 'tomorrow' : `in ${days} days`}, ${fmt(start, { weekday: 'long', month: 'short', day: 'numeric' })}.`;
}

function workoutCard(d, w) {
  const [num, unit] = splitDistance(d.distance);
  return `<article class="card workout" aria-labelledby="wt">
    <p class="eyebrow accent">${esc(w.title)}${w.phase ? ` · ${esc(w.phase)}` : ''}</p>
    <h2 class="workout-title" id="wt">${esc(d.title)}</h2>
    ${d.distance ? `<p class="distance"><span class="num">${esc(num)}</span> <span class="unit">${esc(unit)}</span></p>` : ''}
    ${d.steps.length ? `<ol class="steps">${d.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
    ${d.status ? `<div class="result ${d.status}" role="status">
        <span class="result-icon">${d.status === 'done' ? ICON.check : ICON.x}</span>
        <span>${STATUS[d.status]}${d.miles ? ` · ${d.miles} mi on Strava` : ''}</span>
        <button class="link" data-act="status" data-id="${d.id}" data-v="">Undo</button>
      </div>`
    : `<div class="actions">
        <button class="btn primary" data-act="status" data-id="${d.id}" data-v="done">${ICON.check}Done</button>
        <button class="btn" data-act="status" data-id="${d.id}" data-v="skipped">Skip</button>
      </div>`}
    <button class="link edit-link" data-act="edit-run" data-id="${d.id}">Edit this run</button>
  </article>`;
}

function infoCard(title, body, next) {
  return `<article class="card info">
    <h2 class="workout-title">${title}</h2>
    <p class="note">${body}</p>
    ${next ? `<button class="next" data-act="select" data-date="${next.date}">
      <span class="eyebrow">Next · ${fmt(next.date)}</span>
      <span class="next-title">${esc(next.title)}</span>
      <span class="next-dist">${esc(next.distance)}</span>
    </button>` : ''}
  </article>`;
}

function completeCard(all) {
  const done = all.filter(d => d.status === 'done').length;
  return `<article class="card info">
    <h2 class="workout-title">Plan complete</h2>
    <p class="note">You finished ${done} of ${all.length} runs. Load your next block whenever you’re ready.</p>
    <a class="btn primary" href="#plans">Import a new plan</a>
  </article>`;
}

function weekStrip(p, w, sel, t) {
  const byDate = Object.fromEntries(runs(p).map(d => [d.date, d]));
  const { done, n, pct } = weekProgress(w);
  const cells = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(w.start, i);
    const d = byDate[date];
    const state = d ? (STATUS[d.status] ?? 'Planned') : 'Rest';
    const label = `${fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${d ? `${d.title}, ${state}` : 'Rest'}`;
    return `<li><button class="chip ${d ? d.status || 'planned' : 'rest'}${date === t ? ' is-today' : ''}"
      data-act="select" data-date="${date}" aria-pressed="${date === sel}" aria-label="${esc(label)}">
      <span class="dow">${fmt(date, { weekday: 'narrow' })}</span>
      <span class="dnum">${fromIso(date).getDate()}</span>
      ${statusMark(d) || '<span class="mark"></span>'}
    </button></li>`;
  }).join('');

  return `<section class="week" aria-labelledby="wk">
    <div class="week-head">
      <h2 id="wk">${esc(w.title)} <span class="range">${esc(w.range)}</span></h2>
      ${w.phase ? `<span class="pill">${esc(w.phase)}</span>` : ''}
    </div>
    ${w.goal ? `<p class="goal">${esc(w.goal)}</p>` : ''}
    <ol class="strip">${cells}</ol>
    <div class="progress">
      <div class="bar" role="progressbar" aria-label="Runs done this week" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${n}"><span style="--p:${pct}%"></span></div>
      <p><strong>${done} of ${n}</strong> runs${w.total ? ` · ${esc(w.total.replace(/^approximately\s*/i, '~'))}` : ''}</p>
    </div>
  </section>`;
}

function emptyState() {
  return header('Run Tracker', 'No plan yet') + `<article class="card info">
    <p class="note">Paste in a training plan to get started.</p>
    <button class="btn primary" data-act="import">Import a plan</button>
  </article>`;
}

// ---------- Plan ----------
function viewPlan() {
  const p = plan();
  if (!p) return emptyState();
  const t = today();
  const all = runs(p);
  const current = weekOf(p, t);
  return header('Training plan', esc(p.name), all.length ? `${fmt(all[0].date, { month: 'short', day: 'numeric' })} – ${fmt(all.at(-1).date, { month: 'short', day: 'numeric' })} · ${all.length} runs` : '')
    + p.weeks.map(w => {
      const { done, n } = weekProgress(w);
      return `<section class="plan-week${w === current ? ' is-current' : ''}" aria-labelledby="h-${w.id}">
        <button class="week-btn" data-act="edit-week" data-id="${w.id}" aria-label="Edit ${esc(w.title)} details">
          <span class="week-btn-main">
            <h2 id="h-${w.id}">${esc(w.title)} <span class="range">${esc(w.range)}</span></h2>
            ${w.phase || w.goal ? `<span class="goal">${w.phase ? `<span class="pill">${esc(w.phase)}</span> ` : ''}${esc(w.goal)}</span>` : ''}
          </span>
          <span class="count">${done}/${n}</span>
        </button>
        <ul class="rows">${w.days.map(d => planRow(d, t)).join('')}</ul>
        <div class="week-foot">
          <span>${esc(w.total)}</span>
          <button class="link" data-act="add-run" data-id="${w.id}">+ Add run</button>
        </div>
      </section>`;
    }).join('');
}

function planRow(d, t) {
  return `<li><button class="row ${d.status || ''}${d.date === t ? ' is-today' : ''}" data-act="edit-run" data-id="${d.id}">
    <span class="date"><span class="dow">${fmt(d.date, { weekday: 'short' })}</span><span class="dnum">${fromIso(d.date).getDate()}</span></span>
    <span class="row-body">
      <span class="row-title">${esc(d.title)}</span>
      <span class="row-dist">${esc(d.distance)}${d.miles ? ` · ${d.miles} mi logged` : ''}</span>
    </span>
    <span class="row-status">${d.status ? `${statusMark(d)}<span class="sr">${STATUS[d.status]}</span>` : ''}</span>
  </button></li>`;
}

// ---------- Plans & settings ----------
function viewPlans() {
  const s = state.strava;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return header('Settings', 'Plans')
    + `<section class="group" aria-labelledby="g-plans">
      <h2 class="group-title" id="g-plans">Your plans</h2>
      <ul class="list">${state.plans.map(p => {
        const all = runs(p);
        return `<li><button class="list-row" data-act="edit-plan" data-id="${p.id}">
          <span><span class="list-title">${esc(p.name)}</span>
          <span class="list-sub">${all.length ? `${fmt(all[0].date, { month: 'short', day: 'numeric' })} – ${fmt(all.at(-1).date, { month: 'short', day: 'numeric' })} · ` : ''}${all.length} runs</span></span>
          ${p.id === plan()?.id ? '<span class="badge">Active</span>' : ''}
        </button></li>`;
      }).join('')}</ul>
      <button class="btn primary block" data-act="import">Import a plan</button>
    </section>

    <section class="group" aria-labelledby="g-strava">
      <h2 class="group-title" id="g-strava">Strava</h2>
      ${s.refreshToken ? `<div class="panel">
          <p><strong>Connected${s.athlete ? ` as ${esc(s.athlete)}` : ''}.</strong> Runs from your Fitbit that reach Strava check off the matching day.</p>
          <p class="help">${s.lastSync ? `Last synced ${new Date(s.lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Not synced yet.'}</p>
          <div class="btn-row">
            <button class="btn" data-act="sync">Sync now</button>
            <button class="btn ghost" data-act="disconnect">Disconnect</button>
          </div>
        </div>`
      : `<form class="panel" data-form="strava">
          <ol class="help how">
            <li>Create an app at <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a>.</li>
            <li>Set <em>Authorization Callback Domain</em> to <code>${esc(location.hostname)}</code>.</li>
            <li>Paste its Client ID and Client Secret here.</li>
          </ol>
          <label class="field"><span>Client ID</span><input name="clientId" inputmode="numeric" autocomplete="off" required value="${esc(s.clientId)}"></label>
          <label class="field"><span>Client Secret</span><input name="clientSecret" type="password" autocomplete="off" required value="${esc(s.clientSecret)}"></label>
          <button class="btn primary block">Connect Strava</button>
        </form>`}
    </section>

    <section class="group" aria-labelledby="g-backup">
      <h2 class="group-title" id="g-backup">Backup</h2>
      <div class="panel">
        <p class="help">Your plans and check-offs live only on this phone. Save a backup before deleting the app or switching phones.</p>
        <div class="btn-row">
          <button class="btn" data-act="export">Save backup</button>
          <button class="btn" data-act="restore">Restore</button>
          <input type="file" accept="application/json,.json" id="restore-file" hidden>
        </div>
      </div>
    </section>

    ${standalone ? '' : `<section class="group"><div class="panel hint">
      <p><strong>Install on your iPhone:</strong> open this page in Safari, tap Share, then <em>Add to Home Screen</em>.</p>
    </div></section>`}`;
}

// ---------- sheets (edit dialogs) ----------
function openSheet(title, body, onSave) {
  sheet.innerHTML = `<form class="sheet-form" novalidate>
    <header class="sheet-head">
      <button type="button" class="link" data-close>Cancel</button>
      <h2>${title}</h2>
      <button class="link strong" value="save">Save</button>
    </header>
    <div class="sheet-body">${body}</div>
  </form>`;
  const form = sheet.querySelector('form');
  form.querySelector('[data-close]').onclick = () => sheet.close();
  form.onsubmit = e => {
    e.preventDefault();
    const action = e.submitter?.value || 'save';
    if (action === 'save' && !form.reportValidity()) return;
    if (action === 'delete' && !confirm('Delete this? This can’t be undone.')) return;
    if (onSave(Object.fromEntries(new FormData(form)), action, form) === false) return;
    sheet.close();
    save();
    render();
  };
  sheet.showModal();
}

const field = (label, name, value = '', attrs = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const area = (label, name, value = '', rows = 3, hint = '') =>
  `<label class="field"><span>${label}${hint ? ` <small>${hint}</small>` : ''}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;

function editRun(id, weekId) {
  const found = id ? findRun(id) : null;
  const p = found?.p ?? plan();
  const w = found?.w ?? p.weeks.find(w => w.id === weekId);
  const d = found?.d ?? { id: uid(), date: w.start, title: '', distance: '', steps: [], note: '', status: null };
  const status = d.status ?? '';

  openSheet(found ? 'Edit run' : 'Add run', `
    ${field('Date', 'date', d.date, 'type="date" required')}
    ${field('Workout', 'title', d.title, 'required placeholder="Easy run"')}
    ${field('Distance', 'distance', d.distance, 'placeholder="3 miles"')}
    ${area('Steps', 'steps', d.steps.join('\n'), 4, 'one per line')}
    ${area('Notes', 'note', d.note)}
    <fieldset class="seg"><legend>Status</legend><div class="seg-track">
      ${[['', 'Planned'], ['done', 'Done'], ['skipped', 'Skipped']].map(([v, l]) =>
        `<label><input type="radio" name="status" value="${v}" ${status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div></fieldset>
    ${found ? '<button class="btn danger block" value="delete" formnovalidate>Delete run</button>' : ''}`,
    (f, action) => {
      w.days = w.days.filter(x => x !== d);
      if (action === 'delete') return;
      Object.assign(d, {
        date: f.date, title: f.title.trim(), distance: f.distance.trim(), note: f.note.trim(),
        steps: f.steps.split('\n').map(s => s.trim()).filter(Boolean), status: f.status || null,
      });
      // A moved run joins whichever week now contains its date.
      const target = weekOf(p, d.date) ?? w;
      target.days.push(d);
      target.days.sort((a, b) => a.date.localeCompare(b.date));
    });
}

function editWeek(id) {
  const p = plan();
  const w = p.weeks.find(w => w.id === id);
  openSheet(esc(w.title), `
    ${field('Phase', 'phase', w.phase, 'placeholder="Build"')}
    ${area('Goal', 'goal', w.goal, 2)}
    ${field('Weekly total', 'total', w.total, 'placeholder="approximately 15 miles"')}
    <button class="btn danger block" value="delete" formnovalidate>Delete week</button>`,
    (f, action) => {
      if (action === 'delete') p.weeks = p.weeks.filter(x => x !== w);
      else Object.assign(w, { phase: f.phase.trim(), goal: f.goal.trim(), total: f.total.trim() });
    });
}

function editPlan(id) {
  const p = state.plans.find(p => p.id === id);
  const active = p.id === plan().id;
  openSheet('Plan', `
    ${field('Name', 'name', p.name, 'required')}
    ${active ? '' : '<button class="btn primary block" value="activate">Use this plan</button>'}
    <button class="btn danger block" value="delete" formnovalidate>Delete plan</button>`,
    (f, action) => {
      if (action === 'delete') {
        state.plans = state.plans.filter(x => x !== p);
        if (active) state.activeId = state.plans[0]?.id;
        return;
      }
      p.name = f.name.trim() || p.name;
      if (action === 'activate') { state.activeId = p.id; selected = null; location.hash = 'today'; }
    });
}

function importPlan() {
  openSheet('Import plan', `
    ${field('Name', 'name', '', 'required placeholder="Spring half marathon"')}
    ${area('Plan', 'text', '', 12, 'paste the whole plan')}
    <p class="help" id="preview" aria-live="polite">Each week starts with a line like “Week 1 · Nov 2–8”, then days like “Tue 3” followed by “Easy run — 3 miles”.</p>`,
    (f, action, form) => {
      try {
        const p = newPlan(f.name.trim() || 'New plan', f.text);
        state.plans.push(p);
        state.activeId = p.id;
        selected = null;
        location.hash = 'today';
      } catch (err) {
        form.querySelector('#preview').textContent = err.message;
        form.querySelector('#preview').classList.add('error');
        return false;
      }
    });
  const preview = sheet.querySelector('#preview');
  sheet.querySelector('[name=text]').addEventListener('input', e => {
    try {
      const weeks = parsePlan(e.target.value);
      const all = weeks.flatMap(w => w.days).sort((a, b) => a.date.localeCompare(b.date));
      preview.textContent = `Found ${weeks.length} week${weeks.length === 1 ? '' : 's'} and ${all.length} runs${all.length ? `, ${fmt(all[0].date)} – ${fmt(all.at(-1).date)}` : ''}.`;
      preview.classList.remove('error');
    } catch (err) {
      preview.textContent = err.message;
      preview.classList.add('error');
    }
  });
}

// ---------- Strava ----------
let syncing = false;
async function syncStrava(manual) {
  const s = state.strava, p = plan();
  if (!s.refreshToken || !p || syncing) return;
  if (!manual && Date.now() - (s.lastSync || 0) < 10 * 60e3) return;
  const all = runs(p);
  if (!all.length || all[0].date > today()) return;
  syncing = true;
  try {
    const miles = await strava.runMilesByDate(s, addDays(all[0].date, -1));
    let n = 0;
    // ponytail: matches by calendar date only; a run on an unplanned day isn't attached anywhere.
    for (const d of all) {
      if (!miles[d.date]) continue;
      d.miles = Math.round(miles[d.date] * 10) / 10;
      if (d.status !== 'done') { d.status = 'done'; n++; }
    }
    s.lastSync = Date.now();
    save();
    render();
    if (manual || n) toast(n ? `Checked off ${n} run${n === 1 ? '' : 's'} from Strava` : 'Strava is up to date');
  } catch (err) {
    if (manual) toast(err.message);
  } finally {
    syncing = false;
  }
}

async function finishStravaLogin() {
  const code = params.get('code'), error = params.get('error');
  if (!code && !error) return;
  history.replaceState(null, '', location.pathname + '#plans');
  if (error) return toast('Strava connection was cancelled.');
  try {
    await strava.exchange(state.strava, code);
    save();
    toast('Strava connected');
    syncStrava(true);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- backup ----------
function exportBackup() {
  const blob = new Blob([JSON.stringify({ ...state, strava: {} }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `run-tracker-${today()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.plans)) throw new Error();
    if (!confirm(`Replace your plans with the ${data.plans.length} in this backup?`)) return;
    state = { ...data, strava: state.strava };
    save();
    render();
    toast('Backup restored');
  } catch {
    toast('That file isn’t a Run Tracker backup.');
  }
}

// ---------- shell ----------
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

const VIEWS = { today: viewToday, plan: viewPlan, plans: viewPlans };

function render() {
  const view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'today';
  main.innerHTML = VIEWS[view]();
  document.title = { today: 'Today', plan: 'Plan', plans: 'Plans' }[view] + ' · Run Tracker';
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.hash === `#${view}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

main.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id, date, v } = el.dataset;
  if (act === 'status') {
    findRun(id).d.status = v || null;
    save();
    render();
    main.querySelector('.workout .btn, .workout .result .link')?.focus();
  }
  if (act === 'select') { selected = date === today() ? null : date; render(); }
  if (act === 'edit-run') editRun(id);
  if (act === 'add-run') editRun(null, id);
  if (act === 'edit-week') editWeek(id);
  if (act === 'edit-plan') editPlan(id);
  if (act === 'import') importPlan();
  if (act === 'sync') syncStrava(true);
  if (act === 'disconnect' && confirm('Disconnect Strava?')) { state.strava = {}; save(); render(); }
  if (act === 'export') exportBackup();
  if (act === 'restore') $('#restore-file').click();
});

main.addEventListener('change', e => {
  if (e.target.id === 'restore-file' && e.target.files[0]) restoreBackup(e.target.files[0]);
});

main.addEventListener('submit', e => {
  if (e.target.dataset.form !== 'strava') return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  Object.assign(state.strava, { clientId: f.clientId.trim(), clientSecret: f.clientSecret.trim() });
  save();
  strava.authorize(state.strava);
});

sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); }); // tap backdrop to dismiss

addEventListener('hashchange', () => {
  if (location.hash !== '#today') selected = null;
  render();
  scrollTo(0, 0);
  if (location.hash === '#plan') main.querySelector('.is-current')?.scrollIntoView({ block: 'start' });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); syncStrava(false); }
});

render();
finishStravaLogin().then(() => syncStrava(false));
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js');
