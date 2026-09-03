// BACKGROUND function (note the -background.js suffix -- this is what
// tells Netlify to run this with a 15-minute execution window instead
// of the ~10-26 second limit on regular functions). Does the actual
// work of a real broadcast send: fetches every recipient, sends in
// batches of 100 via Resend's batch endpoint (instead of one email per
// API call), and reports progress into broadcast_send_jobs as it goes
// so the browser can poll for live status.
//
// Triggered by send-broadcast-email.js immediately after it creates the
// job row -- never called directly by the browser.
//
// REQUIRES: RESEND_API_KEY (already set)

const {
  SUPABASE_URL, SUPABASE_ANON_KEY, FROM_ADDRESS,
  buildEmailHtml, fetchAllRpcRows, callRpc,
} = require('./lib/broadcast-email-shared');

const RESEND_BATCH_SIZE = 100; // Resend's own per-batch-call limit

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  const { jobId, token, subject, message, imageUrl, linkText, linkUrl, audience, churchId, courseId, callerRole } = body;
  if (!jobId || !token) {
    return { statusCode: 400, body: 'Missing jobId or token' };
  }

  // Same audience-selection logic the old synchronous function used --
  // a church admin's audience is still never taken from anything in
  // this payload beyond their own role; get_my_church_broadcast_recipients
  // derives their church server-side from their own profile regardless
  // of what churchId (if any) is present here.
  let rpcName, rpcParams;
  if (callerRole === 'church_admin') {
    rpcName = 'get_my_church_broadcast_recipients';
    rpcParams = {};
  } else if (audience === 'subscribers') {
    rpcName = 'get_subscriber_list_recipients';
    rpcParams = {};
  } else {
    rpcName = 'get_broadcast_recipients';
    rpcParams = { p_church_id: churchId || null, p_course_id: courseId || null };
  }

  let recipients;
  try {
    recipients = await fetchAllRpcRows(rpcName, rpcParams, token);
  } catch (err) {
    await safeUpdateJob(jobId, token, 0, 0, 0, 'failed', 'Could not look up recipients: ' + err.message);
    return { statusCode: 200, body: 'done (recipient lookup failed)' };
  }

  const total = recipients.length;
  if (total === 0) {
    await safeUpdateJob(jobId, token, 0, 0, 0, 'done', null);
    return { statusCode: 200, body: 'done (no recipients)' };
  }

  await safeUpdateJob(jobId, token, total, 0, 0, 'running', null);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + RESEND_BATCH_SIZE);
    const payload = batch.map(r => ({
      from: FROM_ADDRESS,
      to: r.email,
      reply_to: 'info@followingjesusbook.com',
      subject,
      html: buildEmailHtml(message, r.unsubscribe_token, imageUrl, linkText, linkUrl),
    }));

    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        sent += batch.length;
      } else {
        // Resend's batch endpoint fails the WHOLE call if any single
        // email in the batch is malformed -- a real tradeoff of
        // batching (one bad address can fail up to 99 good ones in the
        // same batch) versus the alternative of one-at-a-time sending,
        // which cannot finish at this list size at all. Counted here as
        // a batch-level failure rather than guessing which individual
        // recipients succeeded.
        failed += batch.length;
      }
    } catch (err) {
      failed += batch.length;
    }

    await safeUpdateJob(jobId, token, total, sent, failed, 'running', null);
    // Brief pacing between batches -- gentler on Resend's rate limits
    // than firing 80+ batch calls back to back with no delay at all.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  await safeUpdateJob(jobId, token, total, sent, failed, 'done', null);
  return { statusCode: 200, body: `done: ${sent} sent, ${failed} failed of ${total}` };
};

// Job-progress updates are best-effort -- if one fails partway through
// a long send, that shouldn't crash the whole background function and
// abandon the actual sending. Swallows its own errors deliberately.
async function safeUpdateJob(jobId, token, total, sent, failed, status, error) {
  try {
    await callRpc('update_broadcast_send_job', {
      p_job_id: jobId, p_total: total, p_sent: sent, p_failed: failed, p_status: status, p_error: error,
    }, token);
  } catch (err) {
    console.error('Failed to update job progress:', err.message);
  }
}
