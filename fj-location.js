/* Following Jesus -- anonymous coarse location ping for the admin map.
   Runs once per day per area of the site per browser. Sends only a random visitor id
   (plus the signed-in session token, if any, so it can be tied to the account). */
(function(){
  try{
    var p = location.pathname.toLowerCase();
    if(/^\/(admin|dashboard|leader|leader-approval|admin-invite)(\/|$|\.)/.test(p) || /admin|dashboard/.test(p)) return;
    var source = 'site';
    if(/^\/app(\.html)?\/?$/.test(p)) source = 'app';
    else if(/^\/(courses?(\/|$)|course-player|theprocessofpromotion|discipleship-assimilation-essentials|preaching-essentials-course|biblical-parenting-course|how-to-write-publish-book-course)/.test(p)) source = 'course';

    var day = new Date().toISOString().slice(0,10), flag = 'fj_loc_' + source;
    try{ if(localStorage.getItem(flag) === day) return; }catch(e){}

    var vid = null;
    try{
      vid = localStorage.getItem('fj_vid');
      if(!vid){ vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('fj_vid', vid); }
    }catch(e){}

    var token = null;
    try{
      for(var i=0;i<localStorage.length;i++){
        var k = localStorage.key(i);
        if(/^sb-.*-auth-token$/.test(k)){ var v = JSON.parse(localStorage.getItem(k)); token = (v && (v.access_token || (v.currentSession && v.currentSession.access_token))) || null; break; }
      }
    }catch(e){}

    var headers = { 'Content-Type': 'application/json' };
    if(token) headers.Authorization = 'Bearer ' + token;
    fetch('/.netlify/functions/log-location', { method:'POST', headers: headers, keepalive:true, body: JSON.stringify({ source: source, visitorKey: vid }) })
      .then(function(){ try{ localStorage.setItem(flag, day); }catch(e){} })
      .catch(function(){});
  }catch(e){}
})();
