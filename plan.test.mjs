// Run: node plan.test.mjs
import assert from 'node:assert/strict';
import { parsePlan } from './plan.js';
import { SEED_PLAN } from './seed.js';

const oct29 = new Date(2026, 9, 29);
const weeks = parsePlan(SEED_PLAN, oct29);
const days = weeks.flatMap(w => w.days);

assert.equal(weeks.length, 4);
assert.equal(days.length, 16);
assert.deepEqual(weeks.map(w => w.phase), ['Recovery', 'Build', 'Peak week', 'Race week']);
assert.equal(weeks[0].start, '2026-11-02');
assert.equal(weeks[0].total, 'approximately 11–13 miles');

const wed11 = days.find(d => d.date === '2026-11-11');
assert.equal(wed11.title, '10K race-pace intervals');
assert.equal(wed11.distance, '4–5 miles total');
assert.equal(wed11.steps.length, 4);
assert.match(wed11.note, /comfortably hard/);

const race = days.at(-1);
assert.equal(race.date, '2026-11-26');
assert.equal(race.title, 'THANKSGIVING 10K');
assert.deepEqual(race.steps, []);
assert.match(race.note, /^Race day!/);

// Month rollover and year inference.
const dec = parsePlan('Week 1 · Dec 28–Jan 3\nBase\nSat 2\nEasy — 3 miles\nGo slow.', oct29);
assert.equal(dec[0].days[0].date, '2027-01-02');
const jan = parsePlan('Week 1 · Jan 4–10\nBase\nMon 4\nEasy — 3 miles', oct29);
assert.equal(jan[0].start, '2027-01-04');

assert.throws(() => parsePlan('hello'), /No weeks found/);
assert.throws(() => parsePlan('Week 1 · Nov 2–8\nTue 30\nEasy — 3 miles', oct29), /isn't within/);

console.log('plan parser OK');
