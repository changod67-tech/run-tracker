// Run Tracker reminders: stores each phone's push subscription + upcoming runs in KV,
// and every 15 minutes sends a Web Push to phones whose local reminder time has passed on a run day.
// Web Push encryption (RFC 8291) and VAPID (RFC 8292) are done with WebCrypto, no dependencies.

const ALLOWED = ['https://changod67-tech.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const SUBJECT = 'https://changod67-tech.github.io/run-tracker/';
const enc = new TextEncoder();

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || !['/subscribe', '/unsubscribe', '/test'].includes(path)) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    let body;
    try {
      if (Number(req.headers.get('Content-Length') || 0) > 64_000) throw new Error('too big');
      body = await req.json();
      if (!/^https:\/\//.test(body.subscription?.endpoint)) throw new Error('bad subscription');
    } catch {
      return new Response('Bad request', { status: 400, headers: cors });
    }
    const key = await sha256(body.subscription.endpoint);

    if (path === '/unsubscribe') {
      await env.SUBS.delete(key);
    } else if (path === '/test') {
      const r = await sendPush(env, body.subscription, { title: 'Reminders are on', body: 'You’ll get a nudge like this on run days.' });
      return new Response(null, { status: r.ok ? 204 : 502, headers: cors });
    } else {
      const runs = (Array.isArray(body.runs) ? body.runs : []).slice(0, 400).map(r => ({
        date: String(r.date).slice(0, 10), title: String(r.title).slice(0, 120), distance: String(r.distance ?? '').slice(0, 60),
      }));
      const prev = await env.SUBS.get(key, 'json');
      await env.SUBS.put(key, JSON.stringify({
        subscription: body.subscription,
        tz: String(body.tz || 'America/New_York').slice(0, 64),
        time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : '07:00',
        runs,
        lastSent: prev?.lastSent ?? '',
      }));
    }
    return new Response(null, { status: 204, headers: cors });
  },

  async scheduled(_event, env) {
    // ponytail: lists every subscription each tick; fine for a handful of phones, shard by time slot if it grows.
    const { keys } = await env.SUBS.list();
    for (const { name } of keys) {
      const s = await env.SUBS.get(name, 'json');
      if (!s) continue;
      const { date, time } = localNow(s.tz);
      const run = s.runs.find(r => r.date === date);
      if (!run || time < s.time || s.lastSent === date) continue;
      const r = await sendPush(env, s.subscription, {
        title: `Today: ${run.title}`,
        body: run.distance || 'Open the app for the details.',
      });
      if (r.status === 404 || r.status === 410) await env.SUBS.delete(name); // phone unsubscribed
      else if (r.ok) await env.SUBS.put(name, JSON.stringify({ ...s, lastSent: date }));
    }
  },
};

export function localNow(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// ---------- Web Push ----------
async function sendPush(env, sub, message) {
  const body = await encrypt(sub, enc.encode(JSON.stringify(message)));
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, env.VAPID_PRIVATE_JWK);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body,
  });
}

export async function encrypt(sub, plaintext) {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export async function vapidJwt(aud, privateJwk) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = o => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

// ---------- bytes ----------
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
};
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sha256 = async s => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
