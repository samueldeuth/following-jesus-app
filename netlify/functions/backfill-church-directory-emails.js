// netlify/functions/backfill-church-directory-emails.js
//
// ONE-TIME utility -- fills in the contact_email field for the 294
// pending church_directory entries created by
// import-church-directory-candidates.js, which only captured name and
// address at import time. Matches by exact name against the rows
// already sitting in church_directory with status='pending_confirmation'.
//
// Delete this file once the backfill is complete -- not meant to be a
// permanent part of the app.
//
// REQUIRES the same environment variable already used elsewhere:
//   REMINDER_FUNCTION_SECRET
//
// To run, visit in a browser:
//   https://followingjesus.com/.netlify/functions/backfill-church-directory-emails?secret=<REMINDER_FUNCTION_SECRET>

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

const NAME_EMAIL_PAIRS = [
  {
    "name": "Abide Church",
    "email": "matt@abidechico.org"
  },
  {
    "name": "Access Church",
    "email": "office@northeastassembly.org"
  },
  {
    "name": "Amber Dillon- Awaken Church",
    "email": "amber@awakenchurch.com"
  },
  {
    "name": "Anthem Church",
    "email": "tim@anthemchurchva.com"
  },
  {
    "name": "Appleton Gospel Church",
    "email": "parksd@appletongospel.org"
  },
  {
    "name": "Authentic Church",
    "email": "jeff@authenticoc.com"
  },
  {
    "name": "Authentic Life Church",
    "email": "bryan@authenticlifechurch.com"
  },
  {
    "name": "Awaken Church San Diego",
    "email": "assimilation@awakenchurch.com"
  },
  {
    "name": "AZ Vineyard Church",
    "email": "office@azvineyard.com"
  },
  {
    "name": "Bethany Church",
    "email": "abousquin@bethanychurch.com"
  },
  {
    "name": "Bethel Church",
    "email": "accounting@bethel.ag"
  },
  {
    "name": "Bethel Church of Tallmadge",
    "email": "ngregor4@kent.edu"
  },
  {
    "name": "Bettendorf Christian Church",
    "email": "evan@bettendorfcc.com"
  },
  {
    "name": "Bloom Church",
    "email": "mike@bloomhere.org"
  },
  {
    "name": "Bold church",
    "email": "ali@bold.church"
  },
  {
    "name": "Brandon Chapel COG",
    "email": "teryl_lindsey@hotmail.com"
  },
  {
    "name": "Bridge City Community Church",
    "email": "amber@bridgecitycc.org"
  },
  {
    "name": "c/o Souls Church, Inc",
    "email": "ddcalhoun101@gmail.com"
  },
  {
    "name": "C3 Church",
    "email": "angel@c3church.us"
  },
  {
    "name": "C3 Church Belconnen",
    "email": "cheri.colbourn@c3belconnen.org.au"
  },
  {
    "name": "C3 Church Bridgeman Downs",
    "email": "vanessa@c3bd.com"
  },
  {
    "name": "C3 Church Darwin",
    "email": "joey@c3darwin.com"
  },
  {
    "name": "C3 Church Queanbeyan",
    "email": "sarah.williams@c3queanbeyan.com"
  },
  {
    "name": "C3 church sandiego",
    "email": "alex@c3sandiego.com"
  },
  {
    "name": "C3 Church SWWA",
    "email": "admin@c3swwa.com"
  },
  {
    "name": "Caldwell Assembly",
    "email": "aroach@caldwellassembly.com"
  },
  {
    "name": "CALDWELL FIRST ASSEMBLY",
    "email": "bookkeeper@firstassemblyofcaldwell.com"
  },
  {
    "name": "Calvary Church",
    "email": "aalvarado@calvarynaperville.org"
  },
  {
    "name": "Calvary Church of Naperville",
    "email": "lfigueroa@calvarynaperville.org"
  },
  {
    "name": "Calvary Gospel Church",
    "email": "croland@calvarygospel.org"
  },
  {
    "name": "Campbell Ave. Baptist Church",
    "email": "merianlitchford@gmail.com"
  },
  {
    "name": "Canvas Church",
    "email": "admin@canvascda.com"
  },
  {
    "name": "Cedar Park Church Lynnwood",
    "email": "gabby.b@cedarpark.org"
  },
  {
    "name": "Cedar Point Church",
    "email": "aaron@cedarpoint.church"
  },
  {
    "name": "Celebration Church",
    "email": "skuchta@celebrationcc.org"
  },
  {
    "name": "Champions Community Church",
    "email": "olivia@championscc.org"
  },
  {
    "name": "Chapel",
    "email": "amartin@wearechapel.org"
  },
  {
    "name": "Chapel North",
    "email": "antonioh.chapel@gmail.com"
  },
  {
    "name": "Chapelhill Church",
    "email": "michael.gaddis@chapelhill.cc"
  },
  {
    "name": "Chase Oaks Church",
    "email": "otruong@chaseoaks.org"
  },
  {
    "name": "Christ Alive Church",
    "email": "carmen@christalive.com"
  },
  {
    "name": "Christ Church of Central Arkansas",
    "email": "steven@discoverchristchurch.com"
  },
  {
    "name": "Christ Church of Orlando",
    "email": "torry@christchurchorl.org"
  },
  {
    "name": "Christ Place Church",
    "email": "rjustus@christplace.church"
  },
  {
    "name": "Christ Unity Evangelistic Church",
    "email": "dgranger@cueministries.org"
  },
  {
    "name": "Christ's Church A/G",
    "email": "pastortoddk@yahoo.com"
  },
  {
    "name": "Christian World Church",
    "email": "admin@christianworldchurch.com"
  },
  {
    "name": "Christwalk Church",
    "email": "sarah@thechristwalk.com"
  },
  {
    "name": "Church",
    "email": "tk.graham@yahoo.com"
  },
  {
    "name": "Church at the Grove",
    "email": "nathan@churchatthegrove.com"
  },
  {
    "name": "Church Eleven32",
    "email": "cameron@churcheleven32.com"
  },
  {
    "name": "Church of Grace",
    "email": "info@churchofgrace.com"
  },
  {
    "name": "Church of Hope",
    "email": "michael@hopeinocala.com"
  },
  {
    "name": "Church of Jesus Christ Deliverance Center",
    "email": "charlenepye1@gmail.com"
  },
  {
    "name": "Church of the Good Shepherd",
    "email": "bkehncgs@gmail.com"
  },
  {
    "name": "Church of the Midcoast",
    "email": "kevin@midcoast.church"
  },
  {
    "name": "Church Unlimited",
    "email": "brad.austin@churchunlimited.com.au"
  },
  {
    "name": "Church180 KW",
    "email": "elviseziokwu@gmail.com"
  },
  {
    "name": "ChurchCMO",
    "email": "mark@churchcmo.com"
  },
  {
    "name": "Citipointe Church",
    "email": "jterry@citipointechurch.com"
  },
  {
    "name": "City Church Inc",
    "email": "finance@rvacity.org"
  },
  {
    "name": "City Gates Church",
    "email": "shaevonclarke@citygates.london"
  },
  {
    "name": "Cloverhill Church",
    "email": "msoukup@cloverhill.church"
  },
  {
    "name": "Columbia Church of God",
    "email": "columbiachurchofgod@comcast.net"
  },
  {
    "name": "Columbia Heights Assembly",
    "email": "office@columbiaheights.org"
  },
  {
    "name": "Community Fellowship Church",
    "email": "cheryl.ivey@ymail.com"
  },
  {
    "name": "Community Worship Center",
    "email": "ruben@go2cwc.com"
  },
  {
    "name": "Connect Church, Forney",
    "email": "josh@connectforney.org"
  },
  {
    "name": "Connection Church",
    "email": "n.sumner@ourconnection.church"
  },
  {
    "name": "Cornerstone Christian Fellowship",
    "email": "sarah@cornerstonefv.com"
  },
  {
    "name": "Cornerstone Church",
    "email": "office@cornerstonechurchgrafton.org"
  },
  {
    "name": "Cornerstone Church International",
    "email": "info@visitcornerstonechurch.org"
  },
  {
    "name": "Creative church",
    "email": "choua.yang@creativechurch.org"
  },
  {
    "name": "Cross Church",
    "email": "geanna@crossatlanta.com"
  },
  {
    "name": "Cross Community Church",
    "email": "crosscommunitychurch.office@gmail.com"
  },
  {
    "name": "Crossroads Church",
    "email": "sean@lincolncrossroads.com"
  },
  {
    "name": "Crossroads Community Church",
    "email": "corattichop1@gmail.com"
  },
  {
    "name": "Daybreak Church",
    "email": "susie.andrews@daybreakweb.com"
  },
  {
    "name": "Desert Reign Church",
    "email": "veronica@desertreign.org"
  },
  {
    "name": "Desert Springs Church",
    "email": "tinad@desertspringschurch.com"
  },
  {
    "name": "Destiny Christian Center",
    "email": "stevengrant@juno.com"
  },
  {
    "name": "Destiny Church",
    "email": "gailnagy@sbcglobal.net"
  },
  {
    "name": "Destiny Church Alabama",
    "email": "info@destinychurch.al"
  },
  {
    "name": "Destiny Church Naples",
    "email": "amanda@destinynaples.com"
  },
  {
    "name": "Destiny Worship Center",
    "email": "emma@destinyworship.com"
  },
  {
    "name": "Discover Church",
    "email": "mark@discoverchurch.life"
  },
  {
    "name": "District Church",
    "email": "madi@district.church"
  },
  {
    "name": "DP City Church",
    "email": "jcrep333@aol.com"
  },
  {
    "name": "Dwelling Place City Church",
    "email": "elexis@dpcitychurch.com"
  },
  {
    "name": "Eastridge Church",
    "email": "jenny.fullwood@eastridgetoday.com"
  },
  {
    "name": "Elevate ministries Albuquerque",
    "email": "valentinipacheco@yahoo.com"
  },
  {
    "name": "Elevation Church",
    "email": "shaun.hart@elevationchurch.com.au"
  },
  {
    "name": "Elohim Christian Church",
    "email": "pastormynor@elohimchurch.org"
  },
  {
    "name": "Ember Church",
    "email": "jordansims1130@gmail.com"
  },
  {
    "name": "Encounter Church",
    "email": "dianacacique@encounteronline.com"
  },
  {
    "name": "ESTwo47 Church",
    "email": "erik.reed@estwo47.church"
  },
  {
    "name": "Evangel Assembly of God",
    "email": "crystal@evangelwichita.org"
  },
  {
    "name": "Expectation Church",
    "email": "roy@expectation.church"
  },
  {
    "name": "Faith Assembly of God",
    "email": "office@faith-ag.com"
  },
  {
    "name": "Faith Family Church",
    "email": "frontoffice@ffcnw.org"
  },
  {
    "name": "FATHERS HOUSE CHURCH",
    "email": "sam@fathershousechurch.com"
  },
  {
    "name": "Fellowship Church",
    "email": "info@thefellowshipchurch.com"
  },
  {
    "name": "Fellowship of Praise",
    "email": "nathan@fopchurch.net"
  },
  {
    "name": "First Assembly Church",
    "email": "jenny.tabares@fa.church"
  },
  {
    "name": "First Assembly of God",
    "email": "pastorlacey@mh1ag.church"
  },
  {
    "name": "First Baptist Church",
    "email": "donnabp@yahoo.com"
  },
  {
    "name": "First Baptist Church of Flynn",
    "email": "pksony@windstream.net"
  },
  {
    "name": "Florissant Assembly of God",
    "email": "home4174m@yahoo.com"
  },
  {
    "name": "Fountain church",
    "email": "mattwlacey@gmail.com"
  },
  {
    "name": "Free Chapel",
    "email": "agnes.nunley@freechapel.org"
  },
  {
    "name": "Free Chapel Orange County",
    "email": "agnes.nunley@freechapel.org"
  },
  {
    "name": "Free Chapel Worship Center",
    "email": "kendrick.rucker@freechapel.org"
  },
  {
    "name": "Freedom Fellowship Church",
    "email": "keith@ffctv.info"
  },
  {
    "name": "Freedom Life Church",
    "email": "dawn@freedom.life"
  },
  {
    "name": "freetrae church of god",
    "email": "james.tatum@freetrade.church"
  },
  {
    "name": "Gateway Church",
    "email": "lee.dance@gatewaychurch.net.au"
  },
  {
    "name": "Gateway Church Tasmania",
    "email": "craig.guntrip@gatewaychurch.net.au"
  },
  {
    "name": "Gateway City Church",
    "email": "will@gatewaycity.co"
  },
  {
    "name": "Generation Church",
    "email": "rich@mygeneration.cc"
  },
  {
    "name": "GENERATION LIFE CHURCH",
    "email": "mtasiopoulos010@gmail.com"
  },
  {
    "name": "Generations Church",
    "email": "julie@generationschurch.com"
  },
  {
    "name": "Genesis Church",
    "email": "jtuttle@genesispeople.com"
  },
  {
    "name": "Georgetown Baptist Church",
    "email": "donna@georgetownbaptist.net"
  },
  {
    "name": "Golden Gate Assembly of God",
    "email": "pastor@goldengateassembly.org"
  },
  {
    "name": "grace christian church",
    "email": "nathana@gracesterling.com"
  },
  {
    "name": "Grace Church of Rolla",
    "email": "dihagni@gmail.com"
  },
  {
    "name": "Grace Church Southern Pines",
    "email": "joshualett@gracechurchsp.org"
  },
  {
    "name": "Grace Family Church",
    "email": "jkortright@gfcflorida.com"
  },
  {
    "name": "Grace Family Church ST Campus",
    "email": "bdattoma@gfconline.com"
  },
  {
    "name": "Grace Fellowship",
    "email": "morgan.premeaux@gracefellowship.cc"
  },
  {
    "name": "Grace Fellowship Church",
    "email": "jbouvier@gfcnow.com"
  },
  {
    "name": "GraceValley Church",
    "email": "kurt@mygracevalley.com"
  },
  {
    "name": "Greater Church",
    "email": "Jason@greater.church"
  },
  {
    "name": "Harvest Church of Hampton",
    "email": "ministeryaz@gmail.com"
  },
  {
    "name": "Harvest Time Assembly Of God",
    "email": "nathan.cain@htsherman.org"
  },
  {
    "name": "Harvest Time Church",
    "email": "winter@harvesttime.net"
  },
  {
    "name": "Hayfield Assembly Of God",
    "email": "nate@hayfieldassembly.org"
  },
  {
    "name": "Heart Revolution Church",
    "email": "christina@heartrevchurch.com"
  },
  {
    "name": "Heights Church",
    "email": "shawn@heightschurch.co"
  },
  {
    "name": "Hills Church",
    "email": "hanna@hills.church"
  },
  {
    "name": "Hillside Christian Fellowship",
    "email": "dave@hcfclackamas.org"
  },
  {
    "name": "Hillside Community Church",
    "email": "sheena.jakum@hotmail.com"
  },
  {
    "name": "HIS CHURCH",
    "email": "marcialwilcox1926@gmail.com"
  },
  {
    "name": "Home Church",
    "email": "alauwers@homechurchcharleston.org"
  },
  {
    "name": "Hope Alive Church",
    "email": "corina@myhopealive.church"
  },
  {
    "name": "Hope Church NW",
    "email": "wes@hopechurchnw.com"
  },
  {
    "name": "Hope Village Church",
    "email": "emma@hopevillagechurch.com"
  },
  {
    "name": "Hutto Community Church",
    "email": "russell@huttocommunitychurch.org"
  },
  {
    "name": "Inspire Church",
    "email": "randyk@inspire.church"
  },
  {
    "name": "iSEE CHURCH",
    "email": "kimmoriconi@iseechurch.com"
  },
  {
    "name": "iSEE Church Hong Kong",
    "email": "robynstevenson@iseechurch.com"
  },
  {
    "name": "James River Church",
    "email": "ava.snell@jamesriver.church"
  },
  {
    "name": "Johnson Memorial Church",
    "email": "jonathon@jmcexperience.org"
  },
  {
    "name": "Kenosha City Church",
    "email": "brandon@kenosha.church"
  },
  {
    "name": "Keystone Church",
    "email": "lorin@keystonechurchpa.com"
  },
  {
    "name": "Kings Church",
    "email": "noah@kingschurchoh.com"
  },
  {
    "name": "Known Church",
    "email": "nate@knownchurch.co"
  },
  {
    "name": "La Cima church",
    "email": "mramirez4@socal.rr.com"
  },
  {
    "name": "La Pine Christian Center",
    "email": "nrsoyster777@gmail.com"
  },
  {
    "name": "Lakeshore Church",
    "email": "cfauber@lakeshorechurch.net"
  },
  {
    "name": "Launchpoint Church",
    "email": "jkubic@launchpoint.church"
  },
  {
    "name": "Life Church Bethlehem",
    "email": "yashira.valentin@lifechurchlv.org"
  },
  {
    "name": "Life Church Discipleship",
    "email": "dogfans3@sbcglobal.net"
  },
  {
    "name": "Life Church Ministries",
    "email": "vanessa@lifechurchusa.org"
  },
  {
    "name": "Life Point Church",
    "email": "andy@lifepointsa.com"
  },
  {
    "name": "LifeBridge Community Church",
    "email": "tpackard61@gmail.com"
  },
  {
    "name": "LIFECHURCH7",
    "email": "caleb@lifechurch7.com"
  },
  {
    "name": "LifeHouse Church",
    "email": "zach@thelifehousechurch.com"
  },
  {
    "name": "Lifepointe Church",
    "email": "rperry@lifepointechurch.org"
  },
  {
    "name": "LifeStone Church",
    "email": "sandys@lifestonechurch.com"
  },
  {
    "name": "LiFT Church",
    "email": "jt@liftsby.com"
  },
  {
    "name": "Lighthouse Christian Church",
    "email": "patti@lighthousechristian.church"
  },
  {
    "name": "lighthouse church",
    "email": "tyson@lighthousechurch.org"
  },
  {
    "name": "Lighthouse fellowship",
    "email": "clay.lighthouse@me.com"
  },
  {
    "name": "Living Hope Church",
    "email": "heather@lhcmalone.com"
  },
  {
    "name": "Living Revival Ministries",
    "email": "rmhuffman12@gmail.com"
  },
  {
    "name": "Living Waters Church",
    "email": "rwrightrlc@gmail.com"
  },
  {
    "name": "Living Word Church",
    "email": "eva@dlwc.org"
  },
  {
    "name": "Locale Church",
    "email": "ryan@locale.church"
  },
  {
    "name": "Love Church",
    "email": "ben@lovechurch.org"
  },
  {
    "name": "Luminous City Church",
    "email": "carlos@luminouscitysd.org"
  },
  {
    "name": "Magnolia Church",
    "email": "rj.mccauley@magonline.com"
  },
  {
    "name": "Meridian Church of God",
    "email": "pastorkevin@tds.net"
  },
  {
    "name": "Modern Church",
    "email": "brent@modernchurch.org"
  },
  {
    "name": "Mosaic Church Clarksville TN   Marriage Conference   August 2023",
    "email": "bcastrova@mymosaic.ch"
  },
  {
    "name": "Motor City Church",
    "email": "drfavor@me.com"
  },
  {
    "name": "Mountain Home First Assembly",
    "email": "pastorjosh@mh1ag.church"
  },
  {
    "name": "Mountainview Church",
    "email": "stephanie@mfcc.tv"
  },
  {
    "name": "MV Church",
    "email": "bree.harris@mv.church"
  },
  {
    "name": "My city church HQ",
    "email": "jmelgar@mycitychurch.cc"
  },
  {
    "name": "Nations United Church",
    "email": "derrick@nuchurchtx.com"
  },
  {
    "name": "NB Church",
    "email": "eirod173@hotmail.com"
  },
  {
    "name": "Neighborhood Church",
    "email": "goburnco@yahoo.com"
  },
  {
    "name": "New Covenant Church",
    "email": "tlbscout2@aol.com"
  },
  {
    "name": "New Hope Church",
    "email": "rich@nhchurch.com"
  },
  {
    "name": "New Hope Community Church",
    "email": "gioyfifil@gmail.com"
  },
  {
    "name": "New Life Assembly of God",
    "email": "dfreire@newlifelehigh.com"
  },
  {
    "name": "New Life Worship Center",
    "email": "jtranthem@gmail.com"
  },
  {
    "name": "New Song Church",
    "email": "tmorgan@nscbellingham.com"
  },
  {
    "name": "New Tribe Church",
    "email": "admin@newtribe.church"
  },
  {
    "name": "North Point Church",
    "email": "seank@northpointchurch.tv"
  },
  {
    "name": "North Shore Bible Church",
    "email": "whitneyp@northshorebc.org"
  },
  {
    "name": "NorthRock Church",
    "email": "tess@northrocksa.com"
  },
  {
    "name": "Oaks Church McKinney",
    "email": "carson@oakschurch.com"
  },
  {
    "name": "Oasis Church",
    "email": "jerry@oasiscarlsbad.com"
  },
  {
    "name": "Oasis LA Church",
    "email": "katy@oasisla.org"
  },
  {
    "name": "Oceana Ministries",
    "email": "robinsnider223@gmail.com"
  },
  {
    "name": "OKC COMMUNITY CHURCH",
    "email": "scot@okccommunitychurch.com"
  },
  {
    "name": "One Life Church, Inc",
    "email": "mayela.kreiner@gmail.com"
  },
  {
    "name": "One Love Ministries/Waikiki Beach Chaplaincy",
    "email": "nina@onelove.org"
  },
  {
    "name": "Our City Church",
    "email": "katiemoore@ourcity.church"
  },
  {
    "name": "Palmetto Pointe Church",
    "email": "beatriz@palmettopointechurch.com"
  },
  {
    "name": "Pathway Church",
    "email": "deb@pathwayqca.church"
  },
  {
    "name": "Pathway Church Mid County",
    "email": "treasurefrancis@yahoo.com"
  },
  {
    "name": "People's Church",
    "email": "kelly.gibbons@peopleschurch.tv"
  },
  {
    "name": "Pine Grove Community Church",
    "email": "pastordave.pgcc@gmail.com"
  },
  {
    "name": "Plummer Assembly of God",
    "email": "revdet@gmail.com"
  },
  {
    "name": "Production Assistant Grace Family Church",
    "email": "jamypingitore@gmail.com"
  },
  {
    "name": "Purpose Church",
    "email": "elise@wearepurposechurch.com"
  },
  {
    "name": "Radiant Church Waco",
    "email": "nicole@gpecstaff.world"
  },
  {
    "name": "Red Cedar Church",
    "email": "amber@redcedarchurch.com"
  },
  {
    "name": "Refuge Church",
    "email": "dyamil@therefuge.life"
  },
  {
    "name": "Reno Christian Fellowship",
    "email": "robbiebryaniI@gmail.com"
  },
  {
    "name": "Rescue Church",
    "email": "josh@rescuechurchnc.com"
  },
  {
    "name": "Restoration Church ABQ",
    "email": "valentinopacheco@yahoo.com"
  },
  {
    "name": "Restoration Church Bryan",
    "email": "jonathan@restorationbryan.com"
  },
  {
    "name": "Resurrection Life Church",
    "email": "pastorrusty@rezlifechurch.org"
  },
  {
    "name": "Revival City Church",
    "email": "phil@revivalcity.church"
  },
  {
    "name": "Revival City Church Mount Barker",
    "email": "phil@revivalcity.church"
  },
  {
    "name": "Revivify Church",
    "email": "cayla@revivify.church"
  },
  {
    "name": "Revolve Church",
    "email": "courtney@revolvechurch.com"
  },
  {
    "name": "River Church",
    "email": "u.p.riverchurch@fast-air.net"
  },
  {
    "name": "River of Life Fellowship",
    "email": "jimx@theriver.church"
  },
  {
    "name": "Riverside Real Life Church",
    "email": "karmstrong@weareriverside.church"
  },
  {
    "name": "Roca Church",
    "email": "rudy.weber@roca.church"
  },
  {
    "name": "Rock Church",
    "email": "darla@rockag.com"
  },
  {
    "name": "Rock Hills Church",
    "email": "megan@myrockhillschurch.com"
  },
  {
    "name": "RTLA Church",
    "email": "admin@rtlachurch.com"
  },
  {
    "name": "Samuel Deuth Ministries",
    "email": "samueldeuth@gmail.com"
  },
  {
    "name": "Seattle Christian Church",
    "email": "njones.jjones@gmail.com"
  },
  {
    "name": "Sendero Church",
    "email": "celestehernandez120@yahoo.com"
  },
  {
    "name": "Shaping Lives Ministries",
    "email": "lissarie21@gmail.com"
  },
  {
    "name": "Simply Church",
    "email": "sarah@simplychurchgb.com"
  },
  {
    "name": "Souls Church",
    "email": "hello@soulschurch.org"
  },
  {
    "name": "Souls Church, Inc",
    "email": "ddcalhoun101@gmail.com"
  },
  {
    "name": "Sound Life Church",
    "email": "shannond@soundlifechurch.org"
  },
  {
    "name": "South Burleson Baptist Church",
    "email": "drew@southburleson.church"
  },
  {
    "name": "SpiritWord Church",
    "email": "tim.notz@spiritword.church"
  },
  {
    "name": "Springfield Assembly of God",
    "email": "mjmiller@springfieldassembly.net"
  },
  {
    "name": "Story Church",
    "email": "hope@storychurchpdx.com"
  },
  {
    "name": "Storyside Church",
    "email": "info@storysidechurch.com"
  },
  {
    "name": "Strong Tower Church",
    "email": "shawncarter@strongtowerchurch.com"
  },
  {
    "name": "StrongPoint Church",
    "email": "info@strongpointchurch.com"
  },
  {
    "name": "Summit Church",
    "email": "angela.campbell@thesummitchurch.net"
  },
  {
    "name": "SURFCiTY Church",
    "email": "kentg@surfcity.org.au"
  },
  {
    "name": "The Bridge Church",
    "email": "thebridge411@gmail.com"
  },
  {
    "name": "The C3 Church",
    "email": "ktymchuk@gmail.com"
  },
  {
    "name": "The Cause Church",
    "email": "alexhall@thecausecda.com"
  },
  {
    "name": "The Church Covington",
    "email": "darryl@thechurchcov.com"
  },
  {
    "name": "The church of Twin Falls",
    "email": "lziulkowski@hotmail.com"
  },
  {
    "name": "the Church of Twin Falls Idaho",
    "email": "lziulkowski@hotmail.com"
  },
  {
    "name": "The Cure Church",
    "email": "chelseabarlow@thecure.church"
  },
  {
    "name": "The Edge Church",
    "email": "steve@edgeaurora.com"
  },
  {
    "name": "The Gathering Church",
    "email": "micah.mccoy77@gmail.com"
  },
  {
    "name": "The Gathering Covenant Church",
    "email": "pdfflyers@yahoo.com"
  },
  {
    "name": "The Lakeside Church",
    "email": "sonia.rodgers@thelakeside.church"
  },
  {
    "name": "The River Church",
    "email": "jason.neymeyer@gmail.com"
  },
  {
    "name": "The Rock Church",
    "email": "kpeterson@trclife.com"
  },
  {
    "name": "The Rose Church",
    "email": "lauren@rosechurch.org"
  },
  {
    "name": "The Tabernacle Church",
    "email": "babiedall10@yahoo.com"
  },
  {
    "name": "The Table Church",
    "email": "matt@thetablechurch.cc"
  },
  {
    "name": "theChapel",
    "email": "riley7183@gmail.com"
  },
  {
    "name": "TimberCreek Church",
    "email": "kelsey@lufkin.org"
  },
  {
    "name": "Together Church",
    "email": "sabra@togetheraz.church"
  },
  {
    "name": "Toni McCleary c/o The Cure Church lawrence",
    "email": "thecurechurchlawrence@gmail.com"
  },
  {
    "name": "Trademark Church",
    "email": "jessica@trademark.church"
  },
  {
    "name": "Transformation Church",
    "email": "carrie@transformtlh.com"
  },
  {
    "name": "Trinity Church Harlem",
    "email": "daniella@trinityharlem.com"
  },
  {
    "name": "Trinity Ministries Group",
    "email": "kemittman@yahoo.com"
  },
  {
    "name": "True North Church",
    "email": "jen@truenorthak.org"
  },
  {
    "name": "Valley Fellowship Church",
    "email": "callee@valleyfellowship.church"
  },
  {
    "name": "Vessel Church",
    "email": "jon@vesseltxk.church"
  },
  {
    "name": "Victory Church",
    "email": "Jeables@aol.com"
  },
  {
    "name": "Village Church",
    "email": "sdickson0423@gmail.com"
  },
  {
    "name": "Vima Church",
    "email": "hello@vima.church"
  },
  {
    "name": "VIVE Church",
    "email": "amanda@vivechurch.org"
  },
  {
    "name": "VIVE Church Chicago",
    "email": "amyhahn@vivechurch.org"
  },
  {
    "name": "Warriors Hope Ministry",
    "email": "Gary4cav@aol.com"
  },
  {
    "name": "WaterVue Church",
    "email": "info@watervue.church"
  },
  {
    "name": "Wesleyan Church",
    "email": "whitebradley4@gmail.com"
  },
  {
    "name": "Westover Hills Church",
    "email": "becky.burns@westoverhills.church"
  },
  {
    "name": "Whites Road Pentecostal Church",
    "email": "bradsumner@ymail.com"
  },
  {
    "name": "Willmar Assembly of God",
    "email": "pastormanny@willmarag.org"
  },
  {
    "name": "Word of Life Church",
    "email": "tmathews@thelife.cc"
  },
  {
    "name": "Word of Life Church - Highland Colony Campus",
    "email": "jpovolni@thelife.cc"
  },
  {
    "name": "X Church",
    "email": "janice.tirado@thex.church"
  }
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

  const results = [];
  for (const pair of NAME_EMAIL_PAIRS) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_pending_church_email`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_secret: secret, p_name: pair.name, p_email: pair.email })
      });
      const result = await res.json();
      results.push({ name: pair.name, status: result });
    } catch (e) {
      results.push({ name: pair.name, status: 'error', error: e.message });
    }
  }

  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  return { statusCode: 200, body: JSON.stringify({ total: results.length, summary, results }) };
};
