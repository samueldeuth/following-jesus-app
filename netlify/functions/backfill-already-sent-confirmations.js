// netlify/functions/backfill-already-sent-confirmations.js
//
// ONE-TIME remediation script -- marks confirmation_email_sent_at for
// every church that already received the confirmation email (some
// multiple times) during the earlier duplicate-send incident, caused
// by the original send-church-directory-confirmations.js never
// actually recording who'd been emailed. Confirmed against Resend's
// own sent-email log (a real CSV export), not guessed.
//
// This is what makes it safe to resume sending with the FIXED version
// of that function -- without this, resuming would immediately
// re-send to all 247 people who already got it, on top of what
// they've already received, before ever reaching the ~42 who haven't
// gotten anything yet.
//
// Delete this file once run once -- not meant to be permanent.
//
// REQUIRES the same environment variable already used elsewhere:
//   REMINDER_FUNCTION_SECRET
//
// To run, visit in a browser:
//   https://followingjesus.com/.netlify/functions/backfill-already-sent-confirmations?secret=<REMINDER_FUNCTION_SECRET>

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

const ALREADY_EMAILED = [
  "Gary4cav@aol.com",
  "Jason@greater.church",
  "Jeables@aol.com",
  "aalvarado@calvarynaperville.org",
  "aaron@cedarpoint.church",
  "abousquin@bethanychurch.com",
  "accounting@bethel.ag",
  "admin@c3swwa.com",
  "admin@canvascda.com",
  "admin@christianworldchurch.com",
  "admin@newtribe.church",
  "admin@rtlachurch.com",
  "agnes.nunley@freechapel.org",
  "alauwers@homechurchcharleston.org",
  "alex@c3sandiego.com",
  "alexhall@thecausecda.com",
  "ali@bold.church",
  "amanda@destinynaples.com",
  "amanda@vivechurch.org",
  "amartin@wearechapel.org",
  "amber@bridgecitycc.org",
  "amber@redcedarchurch.com",
  "amyhahn@vivechurch.org",
  "angel@c3church.us",
  "angela.campbell@thesummitchurch.net",
  "antonioh.chapel@gmail.com",
  "ava.snell@jamesriver.church",
  "babiedall10@yahoo.com",
  "bcastrova@mymosaic.ch",
  "bdattoma@gfconline.com",
  "beatriz@palmettopointechurch.com",
  "becky.burns@westoverhills.church",
  "bkehncgs@gmail.com",
  "bookkeeper@firstassemblyofcaldwell.com",
  "brad.austin@churchunlimited.com.au",
  "bradsumner@ymail.com",
  "brandon@kenosha.church",
  "bree.harris@mv.church",
  "brent@modernchurch.org",
  "bryan@authenticlifechurch.com",
  "caleb@lifechurch7.com",
  "callee@valleyfellowship.church",
  "carlos@luminouscitysd.org",
  "carmen@christalive.com",
  "carrie@transformtlh.com",
  "carson@oakschurch.com",
  "cayla@revivify.church",
  "celestehernandez120@yahoo.com",
  "cfauber@lakeshorechurch.net",
  "cheri.colbourn@c3belconnen.org.au",
  "choua.yang@creativechurch.org",
  "christina@heartrevchurch.com",
  "clay.lighthouse@me.com",
  "columbiachurchofgod@comcast.net",
  "corattichop1@gmail.com",
  "corina@myhopealive.church",
  "courtney@revolvechurch.com",
  "craig.guntrip@gatewaychurch.net.au",
  "croland@calvarygospel.org",
  "crosscommunitychurch.office@gmail.com",
  "crystal@evangelwichita.org",
  "daniella@trinityharlem.com",
  "darla@rockag.com",
  "dawn@freedom.life",
  "ddcalhoun101@gmail.com",
  "dfreire@newlifelehigh.com",
  "dgranger@cueministries.org",
  "dianacacique@encounteronline.com",
  "dogfans3@sbcglobal.net",
  "donna@georgetownbaptist.net",
  "donnabp@yahoo.com",
  "drew@southburleson.church",
  "dyamil@therefuge.life",
  "elexis@dpcitychurch.com",
  "elise@wearepurposechurch.com",
  "elviseziokwu@gmail.com",
  "emma@destinyworship.com",
  "emma@hopevillagechurch.com",
  "erik.reed@estwo47.church",
  "eva@dlwc.org",
  "evan@bettendorfcc.com",
  "frontoffice@ffcnw.org",
  "gailnagy@sbcglobal.net",
  "geanna@crossatlanta.com",
  "gioyfifil@gmail.com",
  "goburnco@yahoo.com",
  "hanna@hills.church",
  "hello@vima.church",
  "home4174m@yahoo.com",
  "hope@storychurchpdx.com",
  "info@churchofgrace.com",
  "info@destinychurch.al",
  "info@storysidechurch.com",
  "info@strongpointchurch.com",
  "info@thefellowshipchurch.com",
  "info@visitcornerstonechurch.org",
  "info@watervue.church",
  "james.tatum@freetrade.church",
  "jamypingitore@gmail.com",
  "janice.tirado@thex.church",
  "jbouvier@gfcnow.com",
  "jcrep333@aol.com",
  "jeff@authenticoc.com",
  "jen@truenorthak.org",
  "jenny.fullwood@eastridgetoday.com",
  "jerry@oasiscarlsbad.com",
  "jessica@trademark.church",
  "jimx@theriver.church",
  "jkortright@gfcflorida.com",
  "jkubic@launchpoint.church",
  "jmelgar@mycitychurch.cc",
  "jon@vesseltxk.church",
  "jonathan@restorationbryan.com",
  "jonathon@jmcexperience.org",
  "josh@rescuechurchnc.com",
  "joshualett@gracechurchsp.org",
  "jpovolni@thelife.cc",
  "jterry@citipointechurch.com",
  "jtranthem@gmail.com",
  "jtuttle@genesispeople.com",
  "julie@generationschurch.com",
  "karmstrong@weareriverside.church",
  "katiemoore@ourcity.church",
  "keith@ffctv.info",
  "kelly.gibbons@peopleschurch.tv",
  "kelsey@lufkin.org",
  "kemittman@yahoo.com",
  "kendrick.rucker@freechapel.org",
  "kentg@surfcity.org.au",
  "kevin@midcoast.church",
  "kpeterson@trclife.com",
  "ktymchuk@gmail.com",
  "lauren@rosechurch.org",
  "lee.dance@gatewaychurch.net.au",
  "lfigueroa@calvarynaperville.org",
  "lissarie21@gmail.com",
  "lorin@keystonechurchpa.com",
  "lziulkowski@hotmail.com",
  "madi@district.church",
  "marcialwilcox1926@gmail.com",
  "mark@churchcmo.com",
  "mark@discoverchurch.life",
  "matt@abidechico.org",
  "matt@thetablechurch.cc",
  "mayela.kreiner@gmail.com",
  "micah.mccoy77@gmail.com",
  "michael.gaddis@chapelhill.cc",
  "michael@hopeinocala.com",
  "ministeryaz@gmail.com",
  "morgan.premeaux@gracefellowship.cc",
  "mramirez4@socal.rr.com",
  "msoukup@cloverhill.church",
  "mtasiopoulos010@gmail.com",
  "n.sumner@ourconnection.church",
  "nate@hayfieldassembly.org",
  "nate@knownchurch.co",
  "nathan.cain@htsherman.org",
  "nathan@churchatthegrove.com",
  "nathan@fopchurch.net",
  "nathana@gracesterling.com",
  "ngregor4@kent.edu",
  "nicole@gpecstaff.world",
  "nina@onelove.org",
  "noah@kingschurchoh.com",
  "nrsoyster777@gmail.com",
  "office@azvineyard.com",
  "office@columbiaheights.org",
  "office@cornerstonechurchgrafton.org",
  "office@faith-ag.com",
  "office@northeastassembly.org",
  "otruong@chaseoaks.org",
  "parksd@appletongospel.org",
  "pastor@goldengateassembly.org",
  "pastordave.pgcc@gmail.com",
  "pastorjosh@mh1ag.church",
  "pastorlacey@mh1ag.church",
  "pastormanny@willmarag.org",
  "pastormynor@elohimchurch.org",
  "pastorrusty@rezlifechurch.org",
  "pastortoddk@yahoo.com",
  "patti@lighthousechristian.church",
  "pdfflyers@yahoo.com",
  "phil@revivalcity.church",
  "pksony@windstream.net",
  "randyk@inspire.church",
  "revdet@gmail.com",
  "rich@mygeneration.cc",
  "riley7183@gmail.com",
  "rjustus@christplace.church",
  "rmhuffman12@gmail.com",
  "robbiebryaniI@gmail.com",
  "robinsnider223@gmail.com",
  "robynstevenson@iseechurch.com",
  "roy@expectation.church",
  "rperry@lifepointechurch.org",
  "ruben@go2cwc.com",
  "rudy.weber@roca.church",
  "russell@huttocommunitychurch.org",
  "rwrightrlc@gmail.com",
  "ryan@locale.church",
  "sabra@togetheraz.church",
  "sam@fathershousechurch.com",
  "sandys@lifestonechurch.com",
  "sarah.williams@c3queanbeyan.com",
  "sarah@cornerstonefv.com",
  "sarah@simplychurchgb.com",
  "sarah@thechristwalk.com",
  "sdickson0423@gmail.com",
  "sean@lincolncrossroads.com",
  "seank@northpointchurch.tv",
  "shaevonclarke@citygates.london",
  "shannond@soundlifechurch.org",
  "shaun.hart@elevationchurch.com.au",
  "shawn@heightschurch.co",
  "sheena.jakum@hotmail.com",
  "skuchta@celebrationcc.org",
  "sonia.rodgers@thelakeside.church",
  "stephanie@mfcc.tv",
  "steve@edgeaurora.com",
  "steven@discoverchristchurch.com",
  "stevengrant@juno.com",
  "susie.andrews@daybreakweb.com",
  "teryl_lindsey@hotmail.com",
  "tess@northrocksa.com",
  "thebridge411@gmail.com",
  "thecurechurchlawrence@gmail.com",
  "tim.notz@spiritword.church",
  "tim@anthemchurchva.com",
  "tinad@desertspringschurch.com",
  "tk.graham@yahoo.com",
  "tlbscout2@aol.com",
  "tmathews@thelife.cc",
  "tmorgan@nscbellingham.com",
  "torry@christchurchorl.org",
  "tpackard61@gmail.com",
  "treasurefrancis@yahoo.com",
  "u.p.riverchurch@fast-air.net",
  "valentinipacheco@yahoo.com",
  "vanessa@lifechurchusa.org",
  "veronica@desertreign.org",
  "wes@hopechurchnw.com",
  "whitebradley4@gmail.com",
  "whitneyp@northshorebc.org",
  "will@gatewaycity.co",
  "winter@harvesttime.net",
  "yashira.valentin@lifechurchlv.org",
  "zach@thelifehousechurch.com"
];

exports.handler = async function (event) {
  const secret = process.env.REMINDER_FUNCTION_SECRET;
  if (!secret) {
    return { statusCode: 500, body: 'Missing environment variable: REMINDER_FUNCTION_SECRET' };
  }
  const params = event.queryStringParameters || {};
  if (params.secret !== secret) {
    return { statusCode: 401, body: 'Not authorized -- provide the secret query parameter.' };
  }

  // Direct table update via a security-definer RPC would be the usual
  // pattern here, but a plain PATCH with an IN-style filter on
  // contact_email covers all 247 in one request -- still needs to go
  // through a security-definer path since church_directory's RLS
  // blocks the anon key otherwise (same reasoning as everywhere else
  // in this project). Using the already-existing
  // mark_confirmation_email_sent function in a loop instead, matched
  // by looking up each id first.
  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_pending_churches_needing_email`,
    {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller_secret: secret })
    }
  );
  if (!lookupRes.ok) {
    return { statusCode: 502, body: `Could not look up churches: ${await lookupRes.text()}` };
  }
  const pending = await lookupRes.json();
  const emailedSet = new Set(ALREADY_EMAILED.map(e => e.toLowerCase()));
  const toMark = pending.filter(p => emailedSet.has((p.contact_email || '').toLowerCase()));

  const results = [];
  for (const church of toMark) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_confirmation_email_sent`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_secret: secret, p_id: church.id })
      });
      const result = await res.json();
      results.push({ name: church.name, status: result });
    } catch (e) {
      results.push({ name: church.name, status: 'error', error: e.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      totalAlreadyEmailed: ALREADY_EMAILED.length,
      matchedAndMarked: results.length,
      results
    })
  };
};
