/* Shared page code for /spiritual-gifts-assessment and /five-fold-office-assessment.
   Question wording lives in assessment-data.js, not here. */
(function(){
  'use strict';

  // ---------- Setup ----------
  const FJ = window.FJ_ASSESSMENT;
  const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Which assessment? Decided by the URL path.
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  // Each page sets data-assessment on <html>; the path is a fallback.
  const TYPE = document.documentElement.getAttribute('data-assessment') ||
    (path.indexOf('five-fold') > -1 || path.indexOf('fivefold') > -1 ? 'fivefold' : 'gifts');
  const A = FJ.ASSESSMENTS[TYPE];
  const OTHER = FJ.ASSESSMENTS[TYPE === 'gifts' ? 'fivefold' : 'gifts'];
  const ORDER = FJ.buildQuestionOrder(TYPE);
  const PER_PAGE = TYPE === 'gifts' ? 6 : 5;
  const PAGES = Math.ceil(ORDER.length / PER_PAGE);
  const MAX = FJ.maxScore(TYPE);
  const STORE_KEY = 'fj-assessment-' + TYPE + '-v' + FJ.QUESTION_VERSION;
  const IN_APP = navigator.userAgent.indexOf('median') > -1;
  // Short versions of the scale labels for the always-visible answer key.
  const KEY_LABELS = { 1:'Never', 2:'Rarely', 3:'Sometimes', 4:'Often', 5:'Always' };

  document.title = A.title + ' | Following Jesus';

  const app = document.getElementById('app');
  let user = null;          // signed-in (non-anonymous) user, or null
  let state = loadState();  // { answers:{}, page:0, finished:false }
  let lastResult = null;    // latest saved row from Supabase

  // ---------- Small helpers ----------
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function loadState(){
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s === 'object' && s.answers) return { answers:s.answers, page:s.page|0, finished:!!s.finished };
      }
    } catch(e) {}
    return { answers:{}, page:0, finished:false };
  }
  function saveState(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch(e) {} }
  function clearState(){ state = { answers:{}, page:0, finished:false }; try { localStorage.removeItem(STORE_KEY); } catch(e) {} }
  function answeredCount(){ return ORDER.filter(q => FJ.isValidAnswer(state.answers[q.id])).length; }
  function scrollTop(){ window.scrollTo({ top:0, behavior:'instant' in window ? 'instant' : 'auto' }); }

  function renderTopLinks(){
    const nav = document.getElementById('topLinks');
    let html = IN_APP
      ? '<a href="/app">Home</a>'
      : '<a href="https://qrco.de/fjapp">Get the app</a>';
    if (IN_APP) document.getElementById('brandLink').setAttribute('href', '/app');
    if (user) html += '<button type="button" id="signOutBtn">Sign out</button>';
    nav.innerHTML = html;
    const so = document.getElementById('signOutBtn');
    if (so) so.onclick = async () => { await sb.auth.signOut(); user = null; lastResult = null; renderTopLinks(); renderIntro(); };
  }

  function bestUseHtml(){
    const n = FJ.BEST_USE_NOTE;
    let h = '<div class="card note">';
    n.sections.forEach(s => { h += '<h3>' + esc(s.heading) + '</h3><p>' + esc(s.body) + '</p>'; });
    n.verses.forEach(v => { h += '<blockquote class="verse">"' + esc(v.text) + '"<cite>' + esc(v.ref) + '</cite></blockquote>'; });
    h += '<p class="muted">' + esc(n.closing) + '</p></div>';
    return h;
  }

  // ---------- Intro ----------
  function renderIntro(){
    const n = answeredCount();
    const inProgress = n > 0 && !state.finished;
    // Retakes are allowed; the newest result is what shows everywhere.
    // Someone who's already taken it sees their results first, then Retake.
    const startLabel = inProgress ? 'Continue (' + n + ' of ' + ORDER.length + ' answered)'
      : (lastResult ? 'Retake the assessment' : 'Start the assessment');
    const takenOn = lastResult ? new Date(lastResult.created_at).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }) : '';
    app.innerHTML =
      '<div class="hero"><div class="wrap">' +
        '<div class="eyebrow">Free assessment</div>' +
        '<h1>' + esc(A.title) + '</h1>' +
        '<p>' + esc(A.intro) + '</p>' +
        '<div class="meta"><span>' + ORDER.length + ' statements</span><span>About ' + A.minutes + ' minutes</span><span>Free · sign in to see results</span></div>' +
        (lastResult && !inProgress ? '<p class="small" style="color:#a8a399;margin:-10px 0 18px">You took this on ' + esc(takenOn) + '. Retaking it replaces those as your latest results, which is a great way to see how God has grown you.</p>' : '') +
        '<div class="btn-row">' +
          (lastResult && !inProgress
            ? '<button class="btn btn-ember" id="viewLastBtn">See your results</button>' +
              '<button class="btn btn-ghost" id="startBtn">' + esc(startLabel) + '</button>'
            : '<button class="btn btn-ember" id="startBtn">' + esc(startLabel) + '</button>' +
              (lastResult ? '<button class="btn btn-ghost" id="viewLastBtn">See your latest results</button>' : '')) +
          (inProgress ? '<button class="btn btn-ghost" id="restartBtn">Start over</button>' : '') +
        '</div>' +
      '</div></div>' +
      '<section><div class="wrap">' +
        '<div class="eyebrow" style="margin-bottom:8px">Before you begin</div>' +
        '<h2>How to get the most from this</h2>' +
        bestUseHtml() +
        '<p class="small muted" style="margin-top:16px">' + esc(A.footnote) + '</p>' +
        '<p class="small" style="margin-top:8px">Also try the <a href="' + esc(OTHER.path) + '">' + esc(OTHER.title) + '</a>.</p>' +
      '</div></section>';
    document.getElementById('startBtn').onclick = () => {
      if (state.finished) clearState();
      renderQuiz();
    };
    const vl = document.getElementById('viewLastBtn');
    if (vl) vl.onclick = () => renderResults({ scores:lastResult.scores, ranked:lastResult.ranked, created_at:lastResult.created_at });
    const rs = document.getElementById('restartBtn');
    if (rs) rs.onclick = () => { clearState(); renderIntro(); };
    scrollTop();
  }

  // ---------- Questions ----------
  function renderQuiz(){
    if (state.page >= PAGES) state.page = PAGES - 1;
    if (state.page < 0) state.page = 0;
    const start = state.page * PER_PAGE;
    const slice = ORDER.slice(start, start + PER_PAGE);
    let qs = '';
    slice.forEach((q, i) => {
      const num = start + i + 1;
      let opts = '';
      FJ.SCALE.forEach(s => {
        const checked = state.answers[q.id] === s.value ? ' checked' : '';
        opts += '<label title="' + esc(s.label) + '"><input type="radio" name="' + q.id + '" value="' + s.value + '"' + checked + ' aria-label="' + esc(s.label) + '"><span>' + s.value + '</span></label>';
      });
      qs += '<fieldset class="q" id="q-' + q.id + '" style="border:1px solid var(--line)">' +
              '<legend class="hidden">Statement ' + num + '</legend>' +
              '<span class="q-num">' + num + ' of ' + ORDER.length + '</span>' +
              '<p class="q-text">' + esc(q.text) + '</p>' +
              '<div class="scale" role="radiogroup">' + opts + '</div>' +
              '<div class="scale-ends"><span>Never true</span><span>Consistently true</span></div>' +
            '</fieldset>';
    });
    const isLast = state.page === PAGES - 1;
    app.innerHTML =
      '<div class="progress-shell"><div class="wrap">' +
        '<div class="progress-text"><span>' + esc(A.shortTitle) + ' · Page ' + (state.page + 1) + ' of ' + PAGES + '</span><span id="pct"></span></div>' +
        '<div class="progress"><div id="bar"></div></div>' +
        // Answer key, on every page, lined up with the 1–5 buttons below.
        '<div class="scale-key" aria-hidden="true">' + FJ.SCALE.map(s => '<span><b>' + s.value + '</b>' + esc(KEY_LABELS[s.value] || s.label) + '</span>').join('') + '</div>' +
      '</div></div>' +
      '<div class="wrap">' +
        (state.page === 0 ? '<p class="legend">Answer based on what\'s true of you <b>now</b>, not what you hope will be true. The key at the top stays with you on every page.</p>' : '') +
        qs +
        '<div class="quiz-error" id="quizErr"></div>' +
        '<div class="quiz-nav">' +
          '<button class="btn btn-light" id="backBtn">' + (state.page === 0 ? 'Back to intro' : 'Back') + '</button>' +
          '<button class="btn btn-dark" id="nextBtn">' + (isLast ? 'See my results' : 'Next') + '</button>' +
        '</div>' +
      '</div>';
    updateProgress();

    app.querySelectorAll('.scale input').forEach(inp => {
      inp.addEventListener('change', () => {
        state.answers[inp.name] = parseInt(inp.value, 10);
        saveState();
        const box = document.getElementById('q-' + inp.name);
        if (box) box.classList.remove('missing');
        document.getElementById('quizErr').textContent = '';
        updateProgress();
      });
    });
    document.getElementById('backBtn').onclick = () => {
      if (state.page === 0) { renderIntro(); return; }
      state.page--; saveState(); renderQuiz(); scrollTop();
    };
    document.getElementById('nextBtn').onclick = () => {
      const missing = slice.filter(q => !FJ.isValidAnswer(state.answers[q.id]));
      if (missing.length) {
        missing.forEach(q => document.getElementById('q-' + q.id).classList.add('missing'));
        document.getElementById('quizErr').textContent = 'Please answer every statement on this page.';
        document.getElementById('q-' + missing[0].id).scrollIntoView({ behavior:'smooth', block:'center' });
        return;
      }
      if (!isLast) { state.page++; saveState(); renderQuiz(); scrollTop(); return; }
      const result = FJ.scoreAnswers(TYPE, state.answers);
      if (!result.complete) {
        // Shouldn't happen, but if an earlier page has a gap, jump to it.
        const firstGap = ORDER.findIndex(q => !FJ.isValidAnswer(state.answers[q.id]));
        state.page = Math.floor(firstGap / PER_PAGE); saveState(); renderQuiz(); scrollTop();
        return;
      }
      state.finished = true; saveState();
      finish();
    };
    scrollTop();
  }

  function updateProgress(){
    const n = answeredCount();
    const pct = Math.round(n / ORDER.length * 100);
    const bar = document.getElementById('bar'); if (bar) bar.style.width = pct + '%';
    const t = document.getElementById('pct'); if (t) t.textContent = pct + '% complete';
  }

  // ---------- Finish: sign-in wall → save → results ----------
  async function finish(){
    if (!user) { renderWall(); return; }
    const result = FJ.scoreAnswers(TYPE, state.answers);
    app.innerHTML = '<div class="loading">Saving your results…</div>';
    let saveFailed = false;
    try {
      const { data, error } = await sb.from('gift_assessment_results').insert({
        user_id: user.id,
        assessment_type: TYPE,
        question_version: FJ.QUESTION_VERSION,
        answers: state.answers,
        scores: result.scores,
        ranked: result.ranked
      }).select('scores, ranked, created_at').single();
      if (error) throw error;
      lastResult = data;
      clearState();
    } catch (e) {
      console.error('Saving assessment failed', e);
      saveFailed = true; // keep answers in this browser so nothing is lost
    }
    renderResults({ scores:result.scores, ranked:result.ranked, created_at:new Date().toISOString() }, saveFailed);
  }

  function renderWall(){
    const appleSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.63 1.11 8.8.73 1.06 1.6 2.25 2.75 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.33-3.55zM14.18 6.13c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.69-.93 2.69.98.08 1.98-.5 2.59-1.23z"/></svg>';
    const gSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.92l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l4-3.1z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77z"/></svg>';
    app.innerHTML =
      '<section class="wall"><div class="wrap"><div class="card">' +
        '<div class="eyebrow">You finished</div>' +
        '<h2 style="margin-top:8px">Sign in to see your results</h2>' +
        '<p class="muted">Your answers are saved on this device. Sign in and we\'ll save your results to your account so you can come back to them anytime and share them with your pastor.</p>' +
        '<div class="auth-btns">' +
          '<button class="btn btn-light" id="googleBtn">' + gSvg + 'Continue with Google</button>' +
          '<button class="btn btn-dark" id="appleBtn">' + appleSvg + 'Continue with Apple</button>' +
        '</div>' +
        '<p class="small muted" style="margin-top:18px"><button type="button" id="editBtn" style="background:none;border:0;color:var(--ember-dark);cursor:pointer;text-decoration:underline;font-size:14px;padding:0">Go back and review my answers</button></p>' +
      '</div></div></section>';
    // No hash or query in redirectTo, so the OAuth return lands cleanly.
    const redirectTo = window.location.origin + window.location.pathname;
    document.getElementById('googleBtn').onclick = () => sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo, queryParams:{ prompt:'select_account' } } });
    document.getElementById('appleBtn').onclick = () => sb.auth.signInWithOAuth({ provider:'apple', options:{ redirectTo } });
    document.getElementById('editBtn').onclick = () => { state.finished = false; state.page = PAGES - 1; saveState(); renderQuiz(); };
    scrollTop();
  }

  // ---------- Results ----------
  function resourceListHtml(list){
    if (!list || !list.length) return '';
    return '<ul class="res-list">' + list.map(r =>
      '<li><a href="' + esc(r.url) + '"' + (/^https?:/.test(r.url) ? ' target="_blank" rel="noopener"' : '') + '><b>' + esc(r.label) + '</b><span>' + esc(r.note || '') + '</span></a></li>'
    ).join('') + '</ul>';
  }

  function renderResults(res, saveFailed){
    const ranked = (res.ranked || []).filter(k => FJ.categoryByKey(TYPE, k));
    const top = ranked.slice(0, A.topCount);
    const dateStr = res.created_at ? new Date(res.created_at).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }) : '';
    const noun = TYPE === 'gifts' ? 'gift' : 'office';

    let topHtml = '';
    top.forEach((key, i) => {
      const c = FJ.categoryByKey(TYPE, key);
      const score = res.scores[key] || 0;
      topHtml +=
        '<div class="card top-card">' +
          '<span class="rank-badge">' + (i === 0 ? 'Your top ' + noun : '#' + (i + 1)) + '</span>' +
          '<h2>' + esc(c.name) + '</h2>' +
          '<p class="score-line">' + score + ' of ' + MAX + ' · ' + esc(FJ.bandFor(TYPE, score)) + ' · ' + esc(c.scripture) + '</p>' +
          (c.path ? '<p class="path-line">' + esc(c.path) + '</p>' : '') +
          '<p>' + esc(c.description) + '</p>' +
          '<h3 style="margin-top:14px">How it often shows up</h3>' +
          '<ul class="functions">' + c.functions.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
          (FJ.resourcesFor(key).length ? '<h3 style="margin-top:18px">Grow in this ' + noun + '</h3>' + resourceListHtml(FJ.resourcesFor(key)) : '') +
        '</div>';
    });

    const topScore = top.length ? (res.scores[top[0]] || 0) : 0;
    let barsHtml = '';
    ranked.forEach((key, i) => {
      const c = FJ.categoryByKey(TYPE, key);
      const score = res.scores[key] || 0;
      const pct = Math.max(4, Math.round(score / MAX * 100));
      barsHtml +=
        '<div class="bar-row">' +
          '<span class="bar-name">' + esc(c.name) + '</span>' +
          '<span class="bar-score">' + score + '/' + MAX + ' · ' + esc(FJ.bandFor(TYPE, score)) + '</span>' +
          '<div class="bar-track"><div class="bar-fill' + (i < A.topCount ? ' top' : '') + '" style="width:' + pct + '%"></div></div>' +
        '</div>';
    });
    const bandKey = A.bands.map((b, i) => {
      const hi = i === 0 ? MAX : A.bands[i - 1].min - 1;
      const lo = Math.max(b.min, A.categories[0].questions.length);
      return '<span><b>' + esc(b.label) + '</b> ' + lo + '–' + hi + '</span>';
    }).join('');

    const tie = top.length > 1 && (res.scores[top[0]] === res.scores[top[1]]);

    app.innerHTML =
      '<div class="hero"><div class="wrap">' +
        '<div class="eyebrow">Your results' + (dateStr ? ' · ' + esc(dateStr) : '') + '</div>' +
        '<h1>' + esc(A.shortTitle) + ' results</h1>' +
        '<p>Here\'s where you lean right now. Remember, this is a starting point for prayer and conversation with your pastor, not a final word.</p>' +
      '</div></div>' +
      '<section><div class="wrap">' +
        (saveFailed ? '<div class="save-warn">We couldn\'t save these results to your account just now. Your answers are still on this device, so refresh the page to try again.</div>' : '') +
        topHtml +
        (tie ? '<p class="small muted" style="margin-top:12px">Some of your top scores were tied. Where that happened, we ranked higher the one others have most often confirmed in you.</p>' : '') +
        '<div class="card keep-card no-print">' +
          '<h3>Keep a copy of your results</h3>' +
          '<p class="small muted" style="margin:0 0 14px">Email them to yourself to forward to your pastor, or save them as a PDF.</p>' +
          '<div class="btn-row">' +
            (user && user.email ? '<button class="btn btn-dark" id="emailBtn">Email my results</button>' : '') +
            (IN_APP ? '' : '<button class="btn btn-light" id="pdfBtn">Save as PDF</button>') +
          '</div>' +
          '<div class="small" id="emailStatus" style="margin-top:10px; min-height:20px; color:var(--ember-dark)"></div>' +
        '</div>' +
      '</div></section>' +
      '<section style="padding-top:0"><div class="wrap">' +
        '<h2>All your scores</h2>' +
        '<div class="band-key">' + bandKey + '</div>' +
        '<div class="card"><div class="bars">' + barsHtml + '</div></div>' +
      '</div></section>' +
      '<section style="padding-top:0"><div class="wrap">' +
        '<div class="card soon">' +
          '<div class="eyebrow">Coming soon</div>' +
          '<h2 style="margin-top:8px">Invite your pastor to affirm your results</h2>' +
          '<p>' + (TYPE === 'gifts'
            ? 'Soon you\'ll be able to ask your pastor or a mature Christian leader to answer a short version of this assessment about you. Their view matters more than any score.'
            : 'Calling is delegated by the Holy Spirit, affirmed in community, and confirmed or released by those who already serve in the five-fold offices. Soon you\'ll be able to invite your pastor or a leader serving in these offices to weigh in.') + '</p>' +
          '<p style="margin-bottom:0">Until then, share these results with your pastor and ask what they see in you.</p>' +
          '<div id="shareSlot"></div>' +
        '</div>' +
      '</div></section>' +
      '<section style="padding-top:0"><div class="wrap">' +
        '<h2>Keep growing</h2>' +
        resourceListHtml([
          IN_APP ? { label:'Back to the Following Jesus app', note:'Daily devotionals, prayer, and discipleship', url:'/app' }
                 : { label:'The Following Jesus app', note:'Free daily devotionals, prayer, and discipleship', url:'https://qrco.de/fjapp' },
          FJ.LINKS.book,
          { label:'Take the ' + OTHER.title, note:OTHER.categories.length + ' ' + (OTHER.type === 'gifts' ? 'spiritual gifts' : 'offices') + ' · about ' + OTHER.minutes + ' minutes', url:OTHER.path }
        ]) +
      '</div></section>' +
      '<section style="padding-top:0"><div class="wrap">' +
        '<h2>Remember</h2>' + bestUseHtml() +
        '<div class="card invite-card no-print" style="margin-top:22px">' +
          '<h3>Invite a friend to take the assessment</h3>' +
          '<p class="small muted" style="margin:0 0 14px">This sends them a link to the free ' + esc(A.title) + ' so they can discover their own gifts. Your results are not shared.</p>' +
          '<button class="btn btn-light" id="inviteBtn">Invite a friend</button>' +
          '<div class="small" id="inviteStatus" style="margin-top:10px; min-height:20px; color:var(--ember-dark)"></div>' +
        '</div>' +
        '<div class="btn-row no-print" style="margin-top:22px">' +
          '<button class="btn btn-dark" id="retakeBtn">Retake the assessment</button>' +
        '</div>' +
      '</div></section>';

    fillShareSlot();
    document.getElementById('retakeBtn').onclick = () => { clearState(); renderQuiz(); };
    document.getElementById('inviteBtn').onclick = inviteFriend;
    const eb = document.getElementById('emailBtn');
    if (eb) eb.onclick = emailResults;
    const pb = document.getElementById('pdfBtn');
    if (pb) pb.onclick = () => window.print();
    scrollTop();
  }

  // ---------- Invite a friend (shares the assessment link only) ----------
  async function inviteFriend(){
    const url = window.location.origin + A.path;
    const text = "I just took the free " + A.title + " from Following Jesus. It helps you discover how God has gifted you to serve. Take it here:";
    const status = document.getElementById('inviteStatus');
    if (navigator.share) {
      try { await navigator.share({ title: A.title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text + ' ' + url); status.textContent = 'Link copied. Paste it into a text or email to a friend.'; }
    catch (e) { status.textContent = 'Share this link: ' + url; }
  }

  // ---------- Email my results (sent to the signed-in email address) ----------
  async function emailResults(){
    const btn = document.getElementById('emailBtn');
    const status = document.getElementById('emailStatus');
    btn.disabled = true; status.textContent = 'Sending…';
    try {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      const res = await fetch('/.netlify/functions/email-assessment-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
        body: JSON.stringify({ type: TYPE })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong');
      status.textContent = 'Sent to ' + (body.to || user.email) + '. Check your inbox (and spam folder) in a minute.';
      btn.textContent = 'Sent ✓';
    } catch (e) {
      status.textContent = "Couldn't send the email: " + e.message;
      btn.disabled = false;
    }
  }

  // ---------- "Share with my church" ----------
  // Only shown when the person belongs to a church (profiles.church_id).
  // One setting covers both assessments. Pastors only ever see results
  // through a church-scoped security-definer function, never this table.
  async function fillShareSlot(){
    const slot = document.getElementById('shareSlot');
    if (!slot || !user) return;
    try {
      const { data: prof } = await sb.from('profiles').select('church_id').eq('id', user.id).maybeSingle();
      if (!prof || !prof.church_id) return;
      const [{ data: church }, { data: share }] = await Promise.all([
        sb.from('churches').select('name').eq('id', prof.church_id).maybeSingle(),
        sb.from('gift_assessment_sharing').select('share_with_church').eq('user_id', user.id).maybeSingle()
      ]);
      const churchName = (church && church.name) || 'my church';
      let on = !!(share && share.share_with_church);
      slot.innerHTML =
        '<label class="share-row">' +
          '<input type="checkbox" id="shareToggle"' + (on ? ' checked' : '') + '>' +
          '<span><b>Share my results with ' + esc(churchName) + '</b><br>' +
          '<small>Your pastor and church leaders will be able to see your spiritual gifts and five-fold results. You can turn this off anytime.</small></span>' +
        '</label><div class="share-status" id="shareStatus"></div>';
      const box = document.getElementById('shareToggle');
      box.onchange = async () => {
        const next = box.checked;
        const status = document.getElementById('shareStatus');
        status.textContent = 'Saving…';
        const { error } = await sb.from('gift_assessment_sharing').upsert(
          { user_id: user.id, share_with_church: next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        if (error) { box.checked = on; status.textContent = "Couldn't save that. Please try again."; return; }
        on = next;
        status.textContent = next ? 'Shared with ' + churchName + '.' : 'No longer shared.';
      };
    } catch (e) { console.error('Share setting failed to load', e); }
  }

  // ---------- Boot ----------
  async function loadLastResult(){
    if (!user) { lastResult = null; return; }
    try {
      const { data, error } = await sb.from('gift_assessment_results')
        .select('scores, ranked, created_at')
        .eq('user_id', user.id).eq('assessment_type', TYPE)
        .order('created_at', { ascending:false }).limit(1);
      if (error) throw error;
      lastResult = data && data.length ? data[0] : null;
    } catch (e) { console.error('Loading results failed', e); lastResult = null; }
  }

  async function boot(){
    // Anonymous sessions (created by the app) don't count as signed in.
    const { data } = await sb.auth.getSession();
    const s = data && data.session;
    user = s && s.user && !s.user.is_anonymous ? s.user : null;
    renderTopLinks();

    // Clean OAuth leftovers out of the address bar.
    if (window.location.hash.indexOf('access_token') > -1 || /[?&]code=/.test(window.location.search)) {
      history.replaceState(null, '', window.location.pathname);
    }

    // Just came back from sign-in with a finished assessment → save + show results.
    if (user && state.finished && FJ.scoreAnswers(TYPE, state.answers).complete) { finish(); return; }

    await loadLastResult();
    // Profile pages link here with ?view=results to jump straight to them.
    if (lastResult && new URLSearchParams(window.location.search).get('view') === 'results') {
      renderResults({ scores:lastResult.scores, ranked:lastResult.ranked, created_at:lastResult.created_at });
      return;
    }
    renderIntro();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { user = null; renderTopLinks(); }
  });

  boot();
})();
