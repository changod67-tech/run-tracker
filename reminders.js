// Morning run-day reminders, pushed by the Cloudflare Worker in worker/.
const API = 'https://run-tracker-reminders.changod67.workers.dev';
const VAPID_PUBLIC_KEY = 'BJyeQBnY8uJLwklBZrCLI_WnEAWRHNNW1YeN6xLK4-Abfx6eeeNxv4zAz-zWf-baJXwIGn8h9JP1_XGtIcBLWl4';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const subscription = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();

async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`The reminder server didn’t respond (${r.status}). Try again in a minute.`);
}

export async function enable() {
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in iPhone Settings → Notifications → Runs.');
  }
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription())
    ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
}

// Sends the upcoming, not-yet-checked-off runs so the server knows which mornings to ping.
export async function sync(runs, time) {
  const sub = await subscription();
  if (!sub) return;
  await post('/subscribe', {
    subscription: sub.toJSON(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    time,
    runs: runs.map(({ date, title, distance }) => ({ date, title, distance })),
  });
}

export async function test() {
  const sub = await subscription();
  if (sub) await post('/test', { subscription: sub.toJSON() });
}

export async function disable() {
  const sub = await subscription();
  if (!sub) return;
  await post('/unsubscribe', { subscription: sub.toJSON() }).catch(() => {});
  await sub.unsubscribe();
}
