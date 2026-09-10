// netlify/functions/import-church-directory-candidates.js
//
// ONE-TIME utility -- imports the churches identified from a Shopify
// order export's Company + shipping address fields (the "required
// company field, and a lot of times people put their church name
// there" data source Samuel described) as pending_confirmation rows in
// church_directory. Not shown in Find a Church results until each
// church confirms their info via the confirmation email (a separate
// piece -- see send-church-directory-confirmations.js).
//
// The 298 candidates below were already deduplicated against each
// other (near-identical names like "Acacia Church" vs "AcaciaChurch"
// merged) and against every church already in church_directory, so
// this never creates a duplicate pending entry for a church that's
// already a confirmed course customer. Filtered from the raw Shopify
// export using a church-keyword match (contains "church", "ministry",
// "fellowship", "chapel", etc.) to exclude non-church noise like
// "Amazon", "212 Productions", or raw addresses typed into the wrong
// field by mistake.
//
// Batched (default 25 per call) to stay comfortably within Netlify's
// function execution time limit -- 298 sequential Google Places
// geocoding calls in one invocation would risk timing out. Visit the
// URL below repeatedly with an increasing offset until "done: true"
// comes back, or just keep reloading the same URL -- already-imported
// candidates (matched by normalized name) are skipped automatically,
// so it's safe to re-run without creating duplicates.
//
// Delete this file once the import is complete -- it's not meant to
// be a permanent part of the app, just a one-time backfill tool.
//
// REQUIRES the same environment variables already set for the other
// Find a Church functions:
//   GOOGLE_PLACES_API_KEY
//   REMINDER_FUNCTION_SECRET (reused -- same shared-secret pattern
//                             already used for the other bulk/admin-
//                             triggered functions in this project)
//
// To run, visit in a browser (start with offset=0, then increase by
// BATCH_SIZE each time based on the "nextOffset" the response gives
// back):
//   https://followingjesus.com/.netlify/functions/import-church-directory-candidates?secret=<REMINDER_FUNCTION_SECRET>&offset=0

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const BATCH_SIZE = 25;

function normalize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const CANDIDATES = [
  {
    "name": "Abide Church",
    "address": "795 Eastwood Avenue, Chico, CA 95928, US"
  },
  {
    "name": "Access Church",
    "address": "4386 North Chestnut Avenue, Fresno, CA 93726, US"
  },
  {
    "name": "Amber Dillon- Awaken Church",
    "address": "1941 Halley Ct, Escondido, CA 92026, US"
  },
  {
    "name": "Anthem Church",
    "address": "5118 Northwestern Turnpike, Gore, VA 22637, US"
  },
  {
    "name": "Appleton Gospel Church",
    "address": "1509 S MIDPARK DR, APPLETON, WI 54915, US"
  },
  {
    "name": "Authentic Church",
    "address": "1014 Damascus Circle, Costa Mesa, CA 92626, US"
  },
  {
    "name": "Authentic Life Church",
    "address": "6500 West Coal Mine Avenue, Littleton, CO 80123, US"
  },
  {
    "name": "Awaken Church San Diego",
    "address": "7675 Dagget Street, Suite 100, San Diego, CA 92111, US"
  },
  {
    "name": "AZ Vineyard Church",
    "address": "255 N. Litchfield Rd., Goodyear, AZ 85338, US"
  },
  {
    "name": "Bethany Church",
    "address": "500 Breakfast Hill Road, Greenland, NH 03840, US"
  },
  {
    "name": "Bethel Church",
    "address": "1202 N. Maple Ave, Rapid City, SD 57701, US"
  },
  {
    "name": "Bethel Church of Tallmadge",
    "address": "5153 Sunnybrook Road, Kent, OH 44240, US"
  },
  {
    "name": "Bettendorf Christian Church",
    "address": "3487 Towne Pointe Drive, Bettendorf, IA 52722, US"
  },
  {
    "name": "Bloom Church",
    "address": "102 Rides Crest Dr, Branson, MO 65616, US"
  },
  {
    "name": "Bold church",
    "address": "554 CRESTVIEW DR, San Jose, CA 95117, US"
  },
  {
    "name": "Brandon Chapel COG",
    "address": "3818 River Grove Drive, Tampa, FL 33610, US"
  },
  {
    "name": "Bridge City Community Church",
    "address": "14091 SW 3rd Blvd, Newberry, FL 32669, US"
  },
  {
    "name": "c/o Souls Church, Inc",
    "address": "11844 Flanders Circle Northeast, Blaine, MN 55449, US"
  },
  {
    "name": "C3 Church",
    "address": "W7562 US Hwy 10, Ellsworth, WI 54011, US"
  },
  {
    "name": "C3 Church Belconnen",
    "address": "12 Bunduluk Cres, Ngunnawal, ACT 2913, AU"
  },
  {
    "name": "C3 Church Bridgeman Downs",
    "address": "1910 Gympie Road, Bridgeman Downs, QLD 4035, AU"
  },
  {
    "name": "C3 Church Darwin",
    "address": "PO BOX 559, Karama, NT 0812, AU"
  },
  {
    "name": "C3 Church Queanbeyan",
    "address": "2 Laurence Close, Jerrabomberra, NSW 2619, AU"
  },
  {
    "name": "C3 church sandiego",
    "address": "7675 Dagget Street, suite 100, San Diego, CA 92111, US"
  },
  {
    "name": "C3 Church SWWA",
    "address": "11806 Northeast 122nd Avenue, #293, Vancouver, WA 98682, US"
  },
  {
    "name": "Caldwell Assembly",
    "address": "PO Box 744, Caldwell, TX 77836, US"
  },
  {
    "name": "CALDWELL FIRST ASSEMBLY",
    "address": "102 South Broadway Street, Caldwell, TX 77836, US"
  },
  {
    "name": "Calvary Church",
    "address": "9S200 Illinois Route 59, Naperville, IL 60564, US"
  },
  {
    "name": "Calvary Church of Naperville",
    "address": "9S200 Illinois Rte 59, Naperville, IL 60564, US"
  },
  {
    "name": "Calvary Gospel Church",
    "address": "11150 Berry Rd, Waldorf, MD 20603-3990, US"
  },
  {
    "name": "Campbell Ave. Baptist Church",
    "address": "3705 Campbell Ave., Lynchburg, VA 24501, US"
  },
  {
    "name": "Canvas Church",
    "address": "2200 North 7th Street, Coeur d'Alene, ID 83814, US"
  },
  {
    "name": "Cedar Park Church Lynnwood",
    "address": "17931 64th Ave W, Lynnwood, WA 98037, US"
  },
  {
    "name": "Cedar Point Church",
    "address": "1630 North Lynn Riggs Boulevard, Claremore, OK 74017, US"
  },
  {
    "name": "Celebration Church",
    "address": "1135 Bluebell Drive, LIVERMORE, CA 94551, US"
  },
  {
    "name": "Champions Community Church",
    "address": "13111 Bammel N Houston Rd, Houston, TX 77066, US"
  },
  {
    "name": "Chapel",
    "address": "3051 Cloverdale Road, Florence, AL 35633, US"
  },
  {
    "name": "Chapel North",
    "address": "5325 Smothers Road, Westerville, OH 43081, US"
  },
  {
    "name": "Chapelhill Church",
    "address": "8871 Callaway Drive, Winston, GA 30187, US"
  },
  {
    "name": "Chase Oaks Church",
    "address": "241 Legacy Dr, Plano, TX 75023, US"
  },
  {
    "name": "Christ Alive Church",
    "address": "1549 Southwest Boulevard, Newton, NC 28658, US"
  },
  {
    "name": "Christ Church of Central Arkansas",
    "address": "37 Bradford Drive, Little Rock, AR 72227, US"
  },
  {
    "name": "Christ Church of Orlando",
    "address": "2200 South Orange Avenue, Orlando, FL 32806, US"
  },
  {
    "name": "Christ Place Church",
    "address": "1111 Old Cheney Road, Lincoln, NE 68512, US"
  },
  {
    "name": "Christ Unity Evangelistic Church",
    "address": "208 East 61st Street, Chicago, IL 60637, US"
  },
  {
    "name": "Christ's Church A/G",
    "address": "3725 W. Rose Ln., Phoenix, AZ 85019, US"
  },
  {
    "name": "Christian World Church",
    "address": "891 Abrams Road, Richardson, TX 75081, US"
  },
  {
    "name": "Christwalk Church",
    "address": "750 Queens Way, Fernandina Beach, FL 32034, US"
  },
  {
    "name": "Church",
    "address": "15822 130th Pl SE, Renton, WA 98058, US"
  },
  {
    "name": "Church at the Grove",
    "address": "149 Heritage Park, Social Circle, GA 30025, US"
  },
  {
    "name": "Church Eleven32",
    "address": "700 Rivercrest Boulevard, Allen, TX 75002, US"
  },
  {
    "name": "Church of Grace",
    "address": "20623 Deodar Drive, Yorba Linda, CA 92886, US"
  },
  {
    "name": "Church of Hope",
    "address": "11698 SW 140th Loop, Dunnellon, FL 34432, US"
  },
  {
    "name": "Church of Jesus Christ Deliverance Center",
    "address": "1145 Norsworthy Mill, Hampton, GA 30228, US"
  },
  {
    "name": "Church of the Good Shepherd",
    "address": "9795 W County Rd 28, Fostoria, OH 44830, US"
  },
  {
    "name": "Church of the Midcoast",
    "address": "2 Hunter Lane, Topsham, ME 04086, US"
  },
  {
    "name": "Church Unlimited",
    "address": "13 Azalea Street, Deception Bay, QLD 4508, AU"
  },
  {
    "name": "Church180 KW",
    "address": "222 Jackson Street West, 304, Hamilton, ON L8P 4S5, CA"
  },
  {
    "name": "ChurchCMO",
    "address": "1628 Cheney Road, Knoxville, TN 37922, US"
  },
  {
    "name": "Citipointe Church",
    "address": "7533 Lords Chapel Drive, Nashville, TN 37211, US"
  },
  {
    "name": "City Church Inc",
    "address": "4700 Oakleys Ln, Richmond, VA 23231, US"
  },
  {
    "name": "City Gates Church",
    "address": "25 \u2013 29 Clements Road, Ilford,  IG1 1BH, GB"
  },
  {
    "name": "Cloverhill Church",
    "address": "12310 Bailey Bridge Rd, Midlothian, VA 23112, US"
  },
  {
    "name": "Columbia Church of God",
    "address": "39 N 7th St, Columbia, PA 17512, US"
  },
  {
    "name": "Columbia Heights Assembly",
    "address": "3609 Columbia Heights Rd, longview, WA 98632, US"
  },
  {
    "name": "Community Fellowship Church",
    "address": "PO Box 350, Hammon, OK 73650, US"
  },
  {
    "name": "Community Worship Center",
    "address": "22603 Kinard Avenue, Carson, CA 90745, US"
  },
  {
    "name": "Connect Church, Forney",
    "address": "724 Avalon Drive, Heath, TX 75032, US"
  },
  {
    "name": "Connection Church",
    "address": "220 South Mayo Trail, Pikeville, KY 41501, US"
  },
  {
    "name": "Cornerstone Christian Fellowship",
    "address": "17575 Euclid St., Fountain Valley, CA 92708, US"
  },
  {
    "name": "Cornerstone Church",
    "address": "1187 Falls Rd, Grafton, WI 53024, US"
  },
  {
    "name": "Cornerstone Church International",
    "address": "1234 South 82nd Street, Tampa, FL 33619, US"
  },
  {
    "name": "Creative church",
    "address": "13000 63rd Avenue North, Maple Grove, MN 55369, US"
  },
  {
    "name": "Cross Church",
    "address": "1920 East Buckeye Street, Cumming, GA 30040, US"
  },
  {
    "name": "Cross Community Church",
    "address": "118 Preston Street, Elyria, OH 44035, US"
  },
  {
    "name": "Crossroads Church",
    "address": "2019 Preamble Court, Lincoln, NE 68521, US"
  },
  {
    "name": "Crossroads Community Church",
    "address": "4810 Millers Station Rd, Hampstead, MD 21074, US"
  },
  {
    "name": "Daybreak Church",
    "address": "321 Gettysburg Pike, Mechanicsburg, PA 17055, US"
  },
  {
    "name": "Desert Reign Church",
    "address": "11610 Lakewood Blvd., Downey, CA 90241, US"
  },
  {
    "name": "Desert Springs Church",
    "address": "19620 South McQueen Road, Chandler, AZ 85286, US"
  },
  {
    "name": "Destiny Christian Center",
    "address": "2405 Dock Drive, Evans, CO 80620, US"
  },
  {
    "name": "Destiny Church",
    "address": "10610 Immokalee Rd, Naples, FL 34120, US"
  },
  {
    "name": "Destiny Church Alabama",
    "address": "Destiny Church Alabama, 2410 Wall St, Millbrook, AL 36054, US"
  },
  {
    "name": "Destiny Church Naples",
    "address": "10610 Immokalee Rd., Naples, FL 34120, US"
  },
  {
    "name": "Destiny Worship Center",
    "address": "13300 Panama City Beach Pkwy, Panama City Beach, FL 32407, US"
  },
  {
    "name": "Discover Church",
    "address": "1825 Reimer Rd, Wadsworth, OH 44281, US"
  },
  {
    "name": "District Church",
    "address": "7000 Rossmore Ln, El Dorado Hills, CA 95762, US"
  },
  {
    "name": "DP City Church",
    "address": "27100 Girard Street, Hemet, CA 92544, US"
  },
  {
    "name": "Dwelling Place City Church",
    "address": "27100 Girard Street, Hemet, CA 92544, US"
  },
  {
    "name": "Eagle Brook Church",
    "address": "7015 20th Ave S, Centerville, MN 55038, , AL , US"
  },
  {
    "name": "Eastridge Church",
    "address": "24205 SE Issaquah-Fall City Rd, Issaquah, WA 98029, US"
  },
  {
    "name": "Elevate ministries Albuquerque",
    "address": "8700 Warm Wind Pl NW, Albuquerque, NM 87120, US"
  },
  {
    "name": "Elevation Church",
    "address": "9 Grove Creek Close, Reedy Creek, QLD 4227, AU"
  },
  {
    "name": "Elohim Christian Church",
    "address": "8747 111 Street, Richmond Hill, NY 11418, US"
  },
  {
    "name": "Ember Church",
    "address": "14434 Northeast 8th Street, Bellevue, WA 98007, US"
  },
  {
    "name": "Encounter Church",
    "address": "5300 Twin City Highway, Groves, TX 77619, US"
  },
  {
    "name": "ESTwo47 Church",
    "address": "10720 Log Cabin Rd, Denton, MD 21629, US"
  },
  {
    "name": "Eternity Church",
    "address": "8980 Hickman Rd, Unit 200, Clive, IA 50325, US"
  },
  {
    "name": "Evangel Assembly of God",
    "address": "11444 W 21st St N, Wichita, KS 67205, US"
  },
  {
    "name": "Expectation Church",
    "address": "11924 Braddock Road, Fairfax, VA 22030, US"
  },
  {
    "name": "Faith Assembly of God",
    "address": "34 FOX MANOR RD, HAZLE TOWNSHIP, PA 18202, US"
  },
  {
    "name": "Faith Family Church",
    "address": "1702 Milton Way, milton, WA 98354, US"
  },
  {
    "name": "FATHERS HOUSE CHURCH",
    "address": "1228 Washington Way, Longview, WA 98632, US"
  },
  {
    "name": "Fellowship Church",
    "address": "4873 Lone Tree Way, Antioch, CA 94531, US"
  },
  {
    "name": "Fellowship of Praise",
    "address": "8625 E, Clarksville, OH 45113, US"
  },
  {
    "name": "First Assembly Church",
    "address": "6031 Elbow Drive Southwest, Calgary, AB T2V 1J4, CA"
  },
  {
    "name": "First Assembly of God",
    "address": "54 Tall Oaks Ln, Mountain Home, AR 72653, US"
  },
  {
    "name": "First Baptist Church",
    "address": "77 SHELBY SPEIGHTS DR, PURVIS, MS 39475, US"
  },
  {
    "name": "First Baptist Church of Flynn",
    "address": "10394 PR 4311, Marquez, TX 77865, US"
  },
  {
    "name": "Florissant Assembly of God",
    "address": "4 Santa Cruz Drive, Florissant, MO 63031, US"
  },
  {
    "name": "Fountain church",
    "address": "1531 College Avenue, Livermore, CA 94550, US"
  },
  {
    "name": "Free Chapel",
    "address": "2777 McGaw Avenue, Irvine, CA 92614, US"
  },
  {
    "name": "Free Chapel Orange County",
    "address": "2777 McGaw Ave, Irvine, CA 92606, US"
  },
  {
    "name": "Free Chapel Worship Center",
    "address": "3001 McEver Road, Gainesville, GA 30504, US"
  },
  {
    "name": "Freedom Fellowship Church",
    "address": "11044 White Terrace, Oxford, FL 34484, US"
  },
  {
    "name": "Freedom Life Church",
    "address": "789 Gap Newport Pike, Atglen, PA 19310, US"
  },
  {
    "name": "freetrae church of god",
    "address": "146 Hanna Rd, Carthage, MS 39051, US"
  },
  {
    "name": "Gateway Church",
    "address": "100 Don Road, Devonport, TAS 7310, AU"
  },
  {
    "name": "Gateway Church Tasmania",
    "address": "100 Don Road, Devonport, TAS 7310, AU"
  },
  {
    "name": "Gateway City Church",
    "address": "12471 East 106th Place, Commerce City, CO 80022, US"
  },
  {
    "name": "Generation Church",
    "address": "21105 SW 89th PL, Cutler Bay, FL 33189, US"
  },
  {
    "name": "GENERATION LIFE CHURCH",
    "address": "125 Academy Drive, Sutter Creek, CA 95685, US"
  },
  {
    "name": "Generations Church",
    "address": "4019 Executive Park Boulevard Southeast, c/o Julie Steele, Southport, NC 28461, US"
  },
  {
    "name": "Genesis Church",
    "address": "Genesis Church, 5780 Virginia Parkway, McKinney, TX 75071, US"
  },
  {
    "name": "Georgetown Baptist Church",
    "address": "207 GEORGETOWN RD, POTTSBORO, TX 75076, US"
  },
  {
    "name": "Golden Gate Assembly of God",
    "address": "3881 29 Avenue Southwest, Naples, FL 34117, US"
  },
  {
    "name": "grace christian church",
    "address": "44062 Rina Lane, Clinton Township, MI 48038, US"
  },
  {
    "name": "Grace Church of Rolla",
    "address": "12640 U.S. Highway 63 south, Rolla, MO 65401, US"
  },
  {
    "name": "Grace Church Southern Pines",
    "address": "1519 Luther Way, Southern Pines, NC 28387, US"
  },
  {
    "name": "Grace Family Church",
    "address": "5100 W Waters Ave., Tampa, FL 33634, US"
  },
  {
    "name": "Grace Family Church ST Campus",
    "address": "5101 Van Dyke Road, Lutz, FL 33558, US"
  },
  {
    "name": "Grace Fellowship",
    "address": "3312 Lakeview Trail, Canal Winchester, OH 43110, US"
  },
  {
    "name": "Grace Fellowship Church",
    "address": "2314 S Greenwood Dr, Johnson City, TN 37604, US"
  },
  {
    "name": "GraceValley Church",
    "address": "4570 Mackinaw Road, Saginaw, MI 48603, US"
  },
  {
    "name": "Greater Church",
    "address": "1951 MORNING WALK NW, ACWORTH, GA 30102, US"
  },
  {
    "name": "Harvest Church of Hampton",
    "address": "1015 East Little Back River Road, Hampton, VA 23669, US"
  },
  {
    "name": "Harvest Time Assembly Of God",
    "address": "222 S. Heritage Pkwy, Sherman, TX 75092, US"
  },
  {
    "name": "Harvest Time Church",
    "address": "3100 Briar Cliff, Fort Smith, AR 72908, US"
  },
  {
    "name": "Hayfield Assembly Of God",
    "address": "5118 Northwestern Turnpike, Gore, VA 22637, US"
  },
  {
    "name": "Heart Revolution Church",
    "address": "1914 Sweetwater Road, National City, CA 91950, US"
  },
  {
    "name": "Heights Church",
    "address": "8555 Bitter Bush Way, Colorado Springs, CO 80920, US"
  },
  {
    "name": "Hills Church",
    "address": "800 White Rock Road, El Dorado Hills, CA 95762, US"
  },
  {
    "name": "Hillside Christian Fellowship",
    "address": "15097 SE Diamond Drive, Clackamas, OR 97015, US"
  },
  {
    "name": "Hillside Community Church",
    "address": "435 Broad St, Bristol, CT 06010, US"
  },
  {
    "name": "HIS CHURCH",
    "address": "10424 W Bright Angel Circle, Sun City, AZ 85351, US"
  },
  {
    "name": "Home Church",
    "address": "2507 Salem Rd, Charleston, IL 61920, US"
  },
  {
    "name": "Hope Alive Church",
    "address": "3005 N Century Ave, Odessa, TX 79762, US"
  },
  {
    "name": "Hope Church NW",
    "address": "29021 189th Pl SE, Kent, WA 98042-9201, US"
  },
  {
    "name": "Hope Village Church",
    "address": "7036 NE 147th St, Kenmore, WA 98028, US"
  },
  {
    "name": "Hutto Community Church",
    "address": "453 County Road 135, Hutto, TX 78634, US"
  },
  {
    "name": "Inspire Church",
    "address": "94-877 Lumiaina St, Bldg. 12, Waipahu, HI 96797, US"
  },
  {
    "name": "iSEE CHURCH",
    "address": "308 Seventeen Mile Rocks Road, Seventeen Mile Rocks, QLD 4073, AU"
  },
  {
    "name": "iSEE Church Hong Kong",
    "address": "Level 4 United Daily News Centre, 21 Yuk Yat Street, To Kwa Wan, KL , HK"
  },
  {
    "name": "James River Church",
    "address": "6100 N 19th St, Ozark, MO 65721, US"
  },
  {
    "name": "Johnson Memorial Church",
    "address": "8280 North Carolina 50, Angier, NC 27501, US"
  },
  {
    "name": "Kenosha City Church",
    "address": "6009 Pershing Blvd, Kenosha, WI 53142, US"
  },
  {
    "name": "Keystone Church",
    "address": "138 Broadstone Drive, Mars, PA 16046, US"
  },
  {
    "name": "Kings Church",
    "address": "8652 Market Ave N, Canton, OH 44721, US"
  },
  {
    "name": "Known Church",
    "address": "14089 W. Surrey Dr., Surprise, AZ 85379, US"
  },
  {
    "name": "La Cima church",
    "address": "16342 Bradbury Ln, Huntington Beach, CA 92647, US"
  },
  {
    "name": "La Pine Christian Center",
    "address": "51649 Huntington Rd unit 349, La Pine, OR 97739, US"
  },
  {
    "name": "Lakeshore Church",
    "address": "5575 HWY 205 South, Rockwall, TX 75032, US"
  },
  {
    "name": "Launchpoint Church",
    "address": "337 West Baddour Parkway, Lebanon, TN 37087, US"
  },
  {
    "name": "Life Church Bethlehem",
    "address": "4013 Freemansburg Ave., Backdoor, Easton, PA 18045, US"
  },
  {
    "name": "Life Church Discipleship",
    "address": "1423 W 114th St, Jenks, OK 74037, US"
  },
  {
    "name": "Life Church Ministries",
    "address": "258 East North Street, Bethlehem, PA 18018, US"
  },
  {
    "name": "Life Point Church",
    "address": "12330 Craddick Cove, San Antonio, TX 78254, US"
  },
  {
    "name": "LifeBridge Community Church",
    "address": "4292 N Gregory Ave, Fresno, CA 93722, US"
  },
  {
    "name": "LIFECHURCH7",
    "address": "1110 Stevens Drive, Richland, WA 99352, US"
  },
  {
    "name": "LifeHouse Church",
    "address": "4800 Sierra College Boulevard, Rocklin, CA 95677-3803, US"
  },
  {
    "name": "Lifepointe Church",
    "address": "9500 Durant Rd, Raleigh, NC 27614, US"
  },
  {
    "name": "LifeStone Church",
    "address": "3034 Bremen Avenue, Pittsburgh, PA 15227, US"
  },
  {
    "name": "LiFT Church",
    "address": "30483 Dagsboro Road, Salisbury, MD 21804-2182, US"
  },
  {
    "name": "Lighthouse Christian Church",
    "address": "15530 Lake Hills Blvd, Suite 201, Bellevue, WA 98007, US"
  },
  {
    "name": "lighthouse church",
    "address": "3353 Old Conejo Road, Thousand Oaks, CA 91320, US"
  },
  {
    "name": "Lighthouse fellowship",
    "address": "3015 N. Jackrabbit Tr/195ave, Litchfield park, AZ 85340, US"
  },
  {
    "name": "Living Hope Church",
    "address": "57 Rennie Street, Malone, NY 12953, US"
  },
  {
    "name": "Living Revival Ministries",
    "address": "10 134th Street, Chesapeake, WV 25315, US"
  },
  {
    "name": "Living Waters Church",
    "address": "6540 E Sandpiper Way, Prescott Valley, AZ 86314, US"
  },
  {
    "name": "Living Word Church",
    "address": "926 East National Road, Vandalia, OH 45377, US"
  },
  {
    "name": "Locale Church",
    "address": "6002 North Highland Avenue, Tampa, FL 33604, US"
  },
  {
    "name": "Love Church",
    "address": "20120 Blue Sage Parkway, Omaha, NE 68130, US"
  },
  {
    "name": "Luminous City Church",
    "address": "1465 C Street, Unit 3305, San Diego, CA 92101, US"
  },
  {
    "name": "Magnolia Church",
    "address": "8351 Magnolia Ave., Riverside, CA 92504, US"
  },
  {
    "name": "Meridian Church of God",
    "address": "P.O. Box 197, 2130 N. Meridian Rd, Sanford, MI 48657, US"
  },
  {
    "name": "Modern Church",
    "address": "1338 Meredith Way, Clarksville, TN 37042, US"
  },
  {
    "name": "Mosaic Church Clarksville TN   Marriage Conference   August 2023",
    "address": "1020 Garrettsburg Rd, Clarksville, TN 37042, US"
  },
  {
    "name": "Motor City Church",
    "address": "3668 Livernois Rd., Troy, MI 48083, US"
  },
  {
    "name": "Mountain Home First Assembly",
    "address": "54 Tall Oaks Ln, Mountain Home, AR 72653, US"
  },
  {
    "name": "Mountainview Church",
    "address": "7986 Haven Avenue, Rancho Cucamonga, CA 91730, US"
  },
  {
    "name": "MV Church",
    "address": "4815 West Hunt Highway, Queen Creek, AZ 85142, US"
  },
  {
    "name": "My city church HQ",
    "address": "4859 S.97th st, Omaha, NE 68127, US"
  },
  {
    "name": "Nations United Church",
    "address": "8222 Aleppo Pine Ln, Cypress, TX 77433, US"
  },
  {
    "name": "NB Church",
    "address": "26801 Oxford Ct, Hemet, CA 92544, US"
  },
  {
    "name": "Neighborhood Church",
    "address": "247 Estates Drive, Chico, CA 95928, US"
  },
  {
    "name": "New Covenant Church",
    "address": "5621 S FM 2087, Longview, TX 75603, US"
  },
  {
    "name": "New Hope Church",
    "address": "2170 E Saginaw HWY, East Lansing, MI 48823, US"
  },
  {
    "name": "New Hope Community Church",
    "address": "78777 Agnew Road, Hermiston, OR 97838, US"
  },
  {
    "name": "New Life Assembly of God",
    "address": "5146 Leonard Blvd S, Lehigh Acres, FL 33973, US"
  },
  {
    "name": "New Life Worship Center",
    "address": "385 West Borel Drive, Lake Charles, LA 70611, US"
  },
  {
    "name": "New Song Church",
    "address": "412 Island Green Way, Lynden, WA 98264, US"
  },
  {
    "name": "New Tribe Church",
    "address": "1309 N Mt. Juliet Rd, Mt. Juliet, TN 37122, US"
  },
  {
    "name": "North Point Church",
    "address": "3401 West Norton Road, Springfield, MO 65803, US"
  },
  {
    "name": "North Shore Bible Church",
    "address": "P.O. Box 391, Manson, WA 98831, US"
  },
  {
    "name": "NorthRock Church",
    "address": "20079 Stone Oak Parkway Ste 1105, San Antonio, TX 78258, US"
  },
  {
    "name": "Oaks Church McKinney",
    "address": "448 N Custer Rd ste a, McKinney, TX 75071, US"
  },
  {
    "name": "Oasis Church",
    "address": "802 South Main Street, Carlsbad, NM 88220, US"
  },
  {
    "name": "Oasis LA Church",
    "address": "5161 Lankershim Boulevard, Suite 250, Los Angeles, CA 91601, US"
  },
  {
    "name": "Oceana Ministries",
    "address": "411 N. MICHIGAN AVE., Shelby, MI 49455, US"
  },
  {
    "name": "OKC COMMUNITY CHURCH",
    "address": "PO BOX 252, Oklahoma city, OK 73101, US"
  },
  {
    "name": "One Life Church, Inc",
    "address": "6741 Canyon Run Dr, Star, ID 83669, US"
  },
  {
    "name": "One Love Ministries/Waikiki Beach Chaplaincy",
    "address": "670 Auahi Street, Ste A5, Honolulu, HI 96813, US"
  },
  {
    "name": "Our City Church",
    "address": "39620 Strada Bosco, Lake Elisnore, CA 92532, US"
  },
  {
    "name": "Palmetto Pointe Church",
    "address": "2901 Fantasy Way, Myrtle Beach, SC 29579, US"
  },
  {
    "name": "Pathway Church",
    "address": "4330 12th Avenue, Moline, IL 61265, US"
  },
  {
    "name": "Pathway Church Mid County",
    "address": "2005 Dylan Dr, Nederland, TX 77627-4747, US"
  },
  {
    "name": "People's Church",
    "address": "800 East Britton Road, Oklahoma City, OK 73114, US"
  },
  {
    "name": "Pine Grove Community Church",
    "address": "3604 Pine Grove Rd, Seeleys Bay, ON K0H 2N0, CA"
  },
  {
    "name": "Plummer Assembly of God",
    "address": "6425 West Christine Street, Rathdrum, ID 83858, US"
  },
  {
    "name": "Production Assistant Grace Family Church",
    "address": "8625 Cottonway Lane, Tampa, FL 33635, US"
  },
  {
    "name": "Purpose Church",
    "address": "106 Emily Lane, Alpharetta, GA 30009, US"
  },
  {
    "name": "Radiant Church Waco",
    "address": "213 Russell Lane, Hewitt, TX 76643, US"
  },
  {
    "name": "Red Cedar Church",
    "address": "1701 West Allen Street, Rice Lake, WI 54868, US"
  },
  {
    "name": "Refuge Church",
    "address": "4503 Shavano Ct, San Antonio, TX 78230, US"
  },
  {
    "name": "Reno Christian Fellowship",
    "address": "1700 Zolezzi Lane, RENO, NV 89511, US"
  },
  {
    "name": "Rescue Church",
    "address": "2110 Cedar Grove Drive, Durham, NC 27703, US"
  },
  {
    "name": "Restoration Church ABQ",
    "address": "8700 Warm Wind Place Northwest, Albuquerque, NM 87120, US"
  },
  {
    "name": "Restoration Church Bryan",
    "address": "3810 WINDRIDGE DR, Bryan, TX 77802, US"
  },
  {
    "name": "Resurrection Life Church",
    "address": "1085 West McKinley Avenue, Decatur, IL 62526, US"
  },
  {
    "name": "Revival City Church",
    "address": "35 Fleming Avenue, Ridgehaven, SA 5097, AU"
  },
  {
    "name": "Revival City Church Mount Barker",
    "address": "147 Hurling Drive, Mount Barker, SA 5251, AU"
  },
  {
    "name": "Revivify Church",
    "address": "4350 Wheeler Rd, Augusta, GA 30907, US"
  },
  {
    "name": "Revolve Church",
    "address": "13104 Meadow Ridge Dr, Rougemont, NC 27572, US"
  },
  {
    "name": "River Church",
    "address": "317 W Maple St, Iron River, MI 49935, US"
  },
  {
    "name": "River of Life Fellowship",
    "address": "10626 Southeast 216th Street, Kent, WA 98031, US"
  },
  {
    "name": "Riverside Real Life Church",
    "address": "6319 W Sundance Dr, Spokane, WA 99208, US"
  },
  {
    "name": "Roca Church",
    "address": "12858 Nidd Avenue, El Paso, TX 79928, US"
  },
  {
    "name": "Rock Church",
    "address": "5682 South Creosote Drive, Gold Canyon, AZ 85118, US"
  },
  {
    "name": "Rock Hills Church",
    "address": "2610 Farm Bureau Road, Manhattan, KS 66502, US"
  },
  {
    "name": "RTLA Church",
    "address": "550 West Manville Street, Compton, CA 90220, US"
  },
  {
    "name": "Samuel Deuth Ministries",
    "address": "10335 Reserve Drive, Apt 101, San Diego, CA 92127, US"
  },
  {
    "name": "Seattle Christian Church",
    "address": "1400 hubbell place #1514, seattle, WA 98101, US"
  },
  {
    "name": "Sendero Church",
    "address": "16824 Bay Avenue, Montverde, FL 34756, US"
  },
  {
    "name": "Shaping Lives Ministries",
    "address": "527 Stanton Ave., Springfield, OH 45503, US"
  },
  {
    "name": "Simply Church",
    "address": "855 Amberly Trail, Green Bay, WI 54311, US"
  },
  {
    "name": "Souls Church",
    "address": "11844 Flanders Circle Northeast, Blaine, MN 55449, US"
  },
  {
    "name": "Souls Church, Inc",
    "address": "11844 Flanders Circle Northeast, Blaine, MN 55449, US"
  },
  {
    "name": "Sound Life Church",
    "address": "3425 176th St E, Tacoma, WA 98446, US"
  },
  {
    "name": "South Burleson Baptist Church",
    "address": "5016 Lake Valley Court, Fort Worth, TX 76123, US"
  },
  {
    "name": "SpiritWord Church",
    "address": "3019 Sand Dollar Ct, Pevely, MO 63070, US"
  },
  {
    "name": "Springfield Assembly of God",
    "address": "1551 Canton Rd, Akron, OH 44312, US"
  },
  {
    "name": "Story Church",
    "address": "29364 Southwest Brown Road, Wilsonville, OR 97070, US"
  },
  {
    "name": "Storyside Church",
    "address": "541 State Route 97 West, Bellville, OH 44813, US"
  },
  {
    "name": "Strong Tower Church",
    "address": "684 Hog Back Ridge Road, Bethpage, TN 37022, US"
  },
  {
    "name": "StrongPoint Church",
    "address": "4387 Woodstream Drive, Gahanna, OH 43230, US"
  },
  {
    "name": "Summit Church",
    "address": "1420 NC Highway 68N, Oak Ridge, NC 27310, US"
  },
  {
    "name": "SURFCiTY Church",
    "address": "38 Woody Views Way, Robina, QLD 4226, AU"
  },
  {
    "name": "The Bridge Church",
    "address": "2012 Bonnie Brae Avenue, Fort Worth, TX 76111, US"
  },
  {
    "name": "The C3 Church",
    "address": "1065 Walther Boulevard Northwest, Lawrenceville, GA 30043, US"
  },
  {
    "name": "The Cause Church",
    "address": "22 South Lone Tree Road, Spokane Valley, WA 99016, US"
  },
  {
    "name": "The Church Covington",
    "address": "11975 Hwy 142 N, Oxford, GA 30054, US"
  },
  {
    "name": "The church of Twin Falls",
    "address": "1460 Wendell Street, Twin Falls, ID 83301, US"
  },
  {
    "name": "the Church of Twin Falls Idaho",
    "address": "1460 Wendell Street, Twin Falls, ID 83301, US"
  },
  {
    "name": "The Cure Church",
    "address": "3650 North 67th Street, Kansas City, KS 66104, US"
  },
  {
    "name": "The Edge Church",
    "address": "2982 THUNDERBIRD CT W, AURORA, IL 60503, US"
  },
  {
    "name": "The Gathering Church",
    "address": "1616 Quail Meadows Drive, Lancaster, OH 43130, US"
  },
  {
    "name": "The Gathering Covenant Church",
    "address": "730 North 3rd Street, Patterson, CA 95363, US"
  },
  {
    "name": "The Lakeside Church",
    "address": "16001 West Colonial Drive, Oakland, FL 34787, US"
  },
  {
    "name": "The River Church",
    "address": "616 Carlton Ave, Faribault, MN 55021, US"
  },
  {
    "name": "The Rock Church",
    "address": "16891 146th Street Southeast, STE 145, Monroe, WA 98272, US"
  },
  {
    "name": "The Rose Church",
    "address": "80 Southeast Madison Street, Unit 120, Portland, OR 97214, US"
  },
  {
    "name": "The Tabernacle Church",
    "address": "1020 Garrettsburg Road, Clarksville, TN 37042, US"
  },
  {
    "name": "The Table Church",
    "address": "205 Birdir Ct, Dickson, TN 37055, US"
  },
  {
    "name": "theChapel",
    "address": "8833 Mitchell Blvd, New Port Richey, FL 34655, US"
  },
  {
    "name": "TimberCreek Church",
    "address": "2021 South John Redditt Drive, Lufkin, TX 75904, US"
  },
  {
    "name": "Together Church",
    "address": "3917 E Stanford Ave, Gilbert, AZ 85234-3051, US"
  },
  {
    "name": "Toni McCleary c/o The Cure Church lawrence",
    "address": "1712 Brook Street, Lawrence, KS 66044, US"
  },
  {
    "name": "Trademark Church",
    "address": "7101 Trail Lake Drive, Church Office, Fort Worth, TX 76133, US"
  },
  {
    "name": "Transformation Church",
    "address": "2300 Old Bainbridge Rd, Tallahassee, FL 32303, US"
  },
  {
    "name": "Trinity Church Harlem",
    "address": "8 West 126th Street, New York, NY 10027, US"
  },
  {
    "name": "Trinity Ministries Group",
    "address": "945 East Morton Avenue, Porterville, CA 93257, US"
  },
  {
    "name": "True North Church",
    "address": "3295 College Road, Fairbanks, AK 99709, US"
  },
  {
    "name": "Valley Fellowship Church",
    "address": "PO Box 2055, 608 South San Juan Ave, Buena Vista, CO 81211, US"
  },
  {
    "name": "Vessel Church",
    "address": "4 Springcreek Road, Texarkana, TX 75503, US"
  },
  {
    "name": "Victory Church",
    "address": "3550 Bearden Loop Rd, Camden, AR 71701, US"
  },
  {
    "name": "Village Church",
    "address": "117 lee road 612, Smiths, AL 36877, US"
  },
  {
    "name": "Vima Church",
    "address": "802 West Slate Street, Andover, KS 67002, US"
  },
  {
    "name": "VIVE Church",
    "address": "2513 North Avers Avenue, Unit 1, Chicago, IL 60647, US"
  },
  {
    "name": "VIVE Church Chicago",
    "address": "4055 W. Devon Ave., Chicago, IL 60646, US"
  },
  {
    "name": "Warriors Hope Ministry",
    "address": "3518 Davidoff Drive, Sterling Heights, MI 48310, US"
  },
  {
    "name": "WaterVue Church",
    "address": "631 Brawley School Road, 300-211, Mooresville, NC 28117, US"
  },
  {
    "name": "Wesleyan Church",
    "address": "3040 Marlin Dr., Rapid City, SD 57703, US"
  },
  {
    "name": "Westover Hills Church",
    "address": "9340 Westover Hills Boulevard, San Antonio, TX 78251, US"
  },
  {
    "name": "Whites Road Pentecostal Church",
    "address": "9171 Wellington Rd 5, Harriston, ON N0G 1Z0, CA"
  },
  {
    "name": "Willmar Assembly of God",
    "address": "3821 Abbott Drive, Willmar, MN 56201, US"
  },
  {
    "name": "Word of Life Church",
    "address": "5401 Lakeland Dr, Word of Life Church, Flowood, MS 39232, US"
  },
  {
    "name": "Word of Life Church - Highland Colony Campus",
    "address": "670 Highland Colony Parkway, Ridgeland, MS 39157, US"
  },
  {
    "name": "X Church",
    "address": "6600 Bigerton Bend, Canal Winchester, OH 43110, US"
  }
];

async function geocodeAddress(address, apiKey) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.location,places.formattedAddress'
    },
    body: JSON.stringify({ textQuery: address, maxResultCount: 1 })
  });
  const data = await res.json();
  const place = data.places?.[0];
  if (!place?.location) return null;
  return { lat: place.location.latitude, lng: place.location.longitude, formattedAddress: place.formattedAddress || address };
}

exports.handler = async function (event) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const secret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['GOOGLE_PLACES_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const params = event.queryStringParameters || {};
  if (params.secret !== secret) {
    return { statusCode: 401, body: 'Not authorized -- provide the secret query parameter.' };
  }
  const offset = parseInt(params.offset || '0', 10);
  const batch = CANDIDATES.slice(offset, offset + BATCH_SIZE);

  if (!batch.length) {
    return { statusCode: 200, body: JSON.stringify({ done: true, message: 'All candidates processed.' }) };
  }

  // Skip anything already in church_directory (by normalized name) --
  // safe to re-run this same offset, or the whole import, without
  // creating duplicates.
  const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/church_directory?select=name`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const existingNames = new Set((await existingRes.json()).map(r => normalize(r.name)));

  const results = [];
  for (const candidate of batch) {
    if (existingNames.has(normalize(candidate.name))) {
      results.push({ name: candidate.name, status: 'already_exists' });
      continue;
    }
    try {
      const geocoded = await geocodeAddress(candidate.address, apiKey);
      if (!geocoded) {
        results.push({ name: candidate.name, status: 'geocode_failed', address: candidate.address });
        continue;
      }
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/church_directory`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          name: candidate.name,
          address: geocoded.formattedAddress,
          latitude: geocoded.lat,
          longitude: geocoded.lng,
          source: 'shopify_import',
          status: 'pending_confirmation',
          featured: true
        })
      });
      results.push({ name: candidate.name, status: insertRes.ok ? 'imported' : 'insert_failed' });
    } catch (e) {
      results.push({ name: candidate.name, status: 'error', error: e.message });
    }
  }

  const nextOffset = offset + BATCH_SIZE;
  return {
    statusCode: 200,
    body: JSON.stringify({
      done: nextOffset >= CANDIDATES.length,
      processedThisBatch: batch.length,
      totalCandidates: CANDIDATES.length,
      nextOffset: nextOffset < CANDIDATES.length ? nextOffset : null,
      results
    })
  };
};
