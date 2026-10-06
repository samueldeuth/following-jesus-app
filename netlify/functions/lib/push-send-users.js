// netlify/functions/lib/push-send-users.js
//
// "Send this push to these specific people" -- used by chat notifications,
// leader new-message notifications and the weekly leader check-in. Looks up
// every enabled device belonging to the given Supabase user ids (a person
// can have a phone and a tablet) and sends to all of them.
//
// This replaces OneSignal's include_aliases/external_id and tag filters --
// and fixes the old `leader_user_id` tag approach, which the app never
// actually set, so leader notifications were silently reaching no one.

const CHUNK = 100;

async function sendToUsers(userIds, { title, body, data }, { store, fcm, log = console.log }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const summary = { users: ids.length, devices: 0, sent: 0, failed: 0, dead: 0 };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const devices = await store.select(`push_devices?user_id=in.(${slice.join(',')})&enabled=eq.true&select=id,token`);
    if (!devices || devices.length === 0) continue;
    summary.devices += devices.length;
    const res = await fcm.sendMany(
      devices.map((d) => ({ token: d.token, title, body, data, ref: d.id })),
      { concurrency: 20 }
    );
    summary.sent += res.sent; summary.failed += res.failed; summary.dead += res.dead.length;
    if (res.dead.length) await store.rpc('push_delete_tokens', { p_tokens: res.dead }).catch((e) => log('[push] dead-token cleanup failed:', e.message));
  }
  return summary;
}

module.exports = { sendToUsers };
