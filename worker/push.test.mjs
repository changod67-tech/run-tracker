// Run: node worker/push.test.mjs — plays the phone's side to prove the Worker's push payload decrypts.
import assert from 'node:assert/strict';
import { encrypt, hkdf, vapidJwt, localNow } from './index.js';

const enc = new TextEncoder();
const b64url = b => Buffer.from(b).toString('base64url');
const concat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));

// Phone side: a P-256 key pair and auth secret, as PushManager would make.
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: b64url(uaPublic), auth: b64url(auth) } };

const body = await encrypt(sub, enc.encode('{"title":"Today: Easy run"}'));

// Decrypt per RFC 8291 §3.4 as the browser would.
const salt = body.slice(0, 16);
assert.equal(new DataView(body.buffer).getUint32(16), 4096);
const asPublic = body.slice(21, 21 + body[20]);
const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + body[20])));
assert.equal(plain.at(-1), 2);
assert.equal(new TextDecoder().decode(plain.slice(0, -1)), '{"title":"Today: Easy run"}');

// VAPID JWT verifies against the matching public key.
const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwt = await vapidJwt('https://web.push.apple.com', JSON.stringify(await crypto.subtle.exportKey('jwk', vapid.privateKey)));
const [h, p, s] = jwt.split('.');
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, Buffer.from(s, 'base64url'), enc.encode(`${h}.${p}`)));
assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://web.push.apple.com');

// Local time: 11:30 UTC on Nov 3 is 06:30 in New York (EST).
assert.deepEqual(localNow('America/New_York', new Date('2026-11-03T11:30:00Z')), { date: '2026-11-03', time: '06:30' });

console.log('push encryption OK');
