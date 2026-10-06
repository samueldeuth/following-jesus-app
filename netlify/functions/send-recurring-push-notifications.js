// netlify/functions/send-recurring-push-notifications.js
//
// RETIRED. Recurring admin pushes are now converted into scheduled
// campaigns by push-dispatch-background.js at the 08:00 UTC slot (the same
// moment this function used to run), and delivered per-device from there.
// This file is only kept so no deletion is needed in GitHub; it is no longer
// scheduled in netlify.toml and does nothing.

exports.handler = async function () {
  return { statusCode: 410, body: JSON.stringify({ retired: true, replacedBy: 'push-dispatch-background' }) };
};
