// Turns pasted plan text into weeks of dated runs. Format: docs/intent/run-tracker.md
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEK = /^week\s+(\d+)\b\s*[·•|:\-–—]?\s*(.*)$/i;
const DAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+(\d{1,2})$/i;
const RANGE = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})/i;

export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = s => new Date(`${s}T00:00:00`);
export const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const uid = () => crypto.randomUUID();

export function parsePlan(text, today = new Date()) {
  const weeks = [];
  let week = null, day = null, cursor = null;

  for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    let m;
    if ((m = line.match(WEEK))) {
      const r = m[2].match(RANGE);
      const month = r ? MONTHS.indexOf(r[1].toLowerCase()) : -1;
      if (month < 0) throw new Error(`“${line}” needs a start date, like “Week 1 · Nov 2–8”.`);
      // Plans don't say the year: a month far behind today means next year.
      const year = today.getFullYear() + (month < today.getMonth() - 6 ? 1 : 0);
      cursor = new Date(year, month, +r[2]);
      week = { id: uid(), title: `Week ${m[1]}`, range: m[2], start: iso(cursor), phase: '', goal: '', total: '', days: [] };
      weeks.push(week);
      day = null;
    } else if (!week) {
      continue;
    } else if ((m = line.match(/^goal:\s*(.*)$/i))) {
      week.goal = m[1]; day = null;
    } else if ((m = line.match(/^weekly total:\s*(.*)$/i))) {
      week.total = m[1]; day = null;
    } else if ((m = line.match(DAY))) {
      // Walk forward to the day number so "Nov 30–Dec 6" rolls into December.
      const n = +m[2];
      let steps = 0;
      while (cursor.getDate() !== n && steps++ < 7) cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDate() !== n) throw new Error(`“${line}” isn't within ${week.title} (${week.range}).`);
      day = { id: uid(), date: iso(cursor), title: '', distance: '', steps: [], note: '', status: null };
      week.days.push(day);
    } else if (!day) {
      if (!week.phase) week.phase = line;
    } else if (!day.title) {
      const [title, ...dist] = line.split(/\s+[—–-]\s+/);
      day.title = title;
      day.distance = dist.join(' – ');
    } else {
      day.steps.push(line);
    }
  }

  if (!weeks.length) throw new Error('No weeks found. Each week should start with a line like “Week 1 · Nov 2–8”.');
  for (const d of weeks.flatMap(w => w.days)) d.note = d.steps.pop() || '';
  return weeks;
}
