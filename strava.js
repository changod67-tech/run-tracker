// Strava OAuth + activity fetch, straight from the browser. Keys live in the phone's storage only.
import { fromIso } from './plan.js';

const API = 'https://www.strava.com';
export const redirectUri = () => location.origin + location.pathname;

export function authorize(s) {
  location.href = `${API}/oauth/authorize?` + new URLSearchParams({
    client_id: s.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    approval_prompt: 'auto',
    scope: 'activity:read_all',
  });
}

async function token(s, body) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, ...body }),
  });
  if (!r.ok) throw new Error(`Strava sign-in failed (${r.status}). Check your Client ID and Secret.`);
  const j = await r.json();
  s.accessToken = j.access_token;
  s.refreshToken = j.refresh_token;
  s.expiresAt = j.expires_at;
  if (j.athlete) s.athlete = `${j.athlete.firstname ?? ''} ${j.athlete.lastname ?? ''}`.trim();
}

export const exchange = (s, code) => token(s, { code, grant_type: 'authorization_code' });

// Returns { 'YYYY-MM-DD': miles } for runs since `afterIso`.
// ponytail: one page of 200 activities covers any single plan; paginate if plans ever span years.
export async function runMilesByDate(s, afterIso) {
  if (Date.now() / 1000 > (s.expiresAt ?? 0) - 60) {
    await token(s, { refresh_token: s.refreshToken, grant_type: 'refresh_token' });
  }
  const after = Math.floor(fromIso(afterIso).getTime() / 1000);
  const r = await fetch(`${API}/api/v3/athlete/activities?after=${after}&per_page=200`, {
    headers: { Authorization: `Bearer ${s.accessToken}` },
  });
  if (!r.ok) throw new Error(`Strava sync failed (${r.status}).`);
  const miles = {};
  for (const a of await r.json()) {
    if (!/Run/.test(a.sport_type || a.type)) continue;
    const d = a.start_date_local.slice(0, 10);
    miles[d] = (miles[d] || 0) + a.distance / 1609.344;
  }
  return miles;
}
