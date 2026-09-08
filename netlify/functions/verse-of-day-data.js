// netlify/functions/verse-of-day-data.js
//
// Curated Verse of the Day reference list -- 458 unique verses pulled
// from Samuel's own six "52 Bible Verses" devotionals (Hope, Miracles,
// New Believer, Kids, Men, Youth) plus additional hand-picked verses,
// deduplicated. Only bare book/chapter/verse references are stored here
// -- never verse text -- so this file carries no copyright concern and
// stays tiny. The actual verse wording is fetched live from
// bible-api.com at display/send time (same as this project's other
// Bible-reading and reading-plan features), using the 3-letter book
// codes from BOOKS in reading-plan-data.js (e.g. "PSA 91:1").
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH for the Verse of the Day
// feature. Both app.html's Today-tab card and this function's own daily
// "Verse of the Day" push notification index into THIS SAME ARRAY using
// the identical day-index formula (see verseOfDayIndex() here and in
// app.html) -- that's what keeps the card and the push always showing
// the same verse on the same day. If you ever change this list (add,
// remove, or reorder verses), you MUST re-upload the matching updated
// copy embedded in app.html at the same time, or the two will drift
// out of sync -- same class of bug as the old reading-plan mismatch
// this feature was built to fix.
//
// Cycle length is 458, not 365 -- there are more curated verses than
// days in a year, so the list simply takes longer than a year to loop
// back to the start rather than repeating within a single year. Nothing
// needs to be trimmed; the modulo below handles any list length.
//
// ORDER: deliberately randomized (fixed seed 20260101, Python's
// random.Random(20260101).shuffle()), not canonical Bible order --
// Samuel wanted a mix of Old and New Testament day to day rather than
// weeks of only Genesis/Psalms before ever reaching the Gospels. The
// seed is fixed so the shuffle is reproducible if this list ever needs
// to be regenerated from the same 458 references (same order every
// time), rather than true unseeded randomness that couldn't be
// recreated. If new verses are added later, re-shuffling the whole list
// changes every day's verse from that point on -- append new verses to
// the end instead of re-shuffling, unless a full re-randomization (and
// matching update to BOTH this file and app.html) is specifically
// wanted.
//
// EPOCH: a fixed anchor date, not "Jan 1 of the current year" (unlike
// the reading plan's calendarPlanDay()). Anchoring to a fixed date
// means the 458-day cycle runs continuously across year boundaries
// instead of resetting to index 0 every New Year's Day, which is what
// "cycle through the whole list" is intended to mean here.

const VERSE_OF_DAY_LIST = ["PSA 139:13-16", "DAN 11:32", "JHN 3:30", "ROM 10:9", "PSA 37:23-24", "MRK 6:4-5", "1CO 10:31", "JHN 11:25-26", "1TI 6:17", "2CO 1:3-4", "1TH 1:3", "ACT 4:12", "ROM 12:12", "2TI 2:15", "2CO 5:17", "MRK 8:34", "PSA 71:5", "ISA 57:18-19", "ROM 12:9", "MAT 11:29", "JER 33:6-7", "PSA 5:11-12", "GAL 5:22-23", "1CO 15:19", "PSA 4:8", "MAT 9:23-25", "2TI 2:22", "1PE 3:14-16", "GAL 2:20", "GAL 1:10", "PHP 2:5", "1CO 13:4-7", "1PE 1:13", "LUK 6:38", "PRO 14:12", "EPH 6:13", "GEN 1:1-3", "1CO 6:18", "ROM 15:13", "1CO 6:19-20", "ISA 41:10", "LUK 16:10", "ROM 8:32", "LUK 2:52", "PSA 119:81", "PSA 62:5", "PRO 9:10", "MRK 5:25-29", "JAS 5:13-14", "MAL 3:10-12", "PSA 23:1-4", "1CH 16:11-12", "PSA 103:2-5", "PSA 34:1", "MAT 6:19-21", "MAT 5:9", "JHN 6:35", "JHN 16:33", "1TH 5:11", "JHN 3:16-17", "JHN 8:32", "MAT 7:24-27", "JHN 1:1", "PRO 4:20-22", "2CH 16:9", "ROM 10:17", "2CO 4:16-18", "MRK 10:42-45", "1TI 6:10-11", "PRO 10:12", "MAT 5:14-16", "PSA 56:3", "MAT 28:18-20", "LUK 13:11-13", "EPH 2:8-9", "PRO 13:20", "MAT 11:28", "HEB 12:1-2", "1TH 5:21-22", "PSA 146:7-8", "ROM 8:14", "PSA 42:11", "1CO 15:33", "PSA 90:12", "1PE 5:5-6", "PSA 18:13-14", "GEN 8:22", "GAL 5:5", "2CO 5:21", "MAT 14:14-21", "EPH 1:17-19", "JAS 5:16", "DEU 8:3", "PSA 46:10", "MAT 6:25-26", "JAS 4:8", "PSA 34:18", "LUK 4:34-35", "MAT 6:9-13", "PHP 2:3-4", "PSA 19:1", "PSA 23:6", "MAT 6:10", "PSA 52:9", "GEN 1:27", "PSA 33:16-18", "2CO 3:12", "PRO 10:4", "EPH 6:10-14", "JHN 1:14", "LUK 6:19", "MAT 22:37-39", "JHN 15:7", "COL 3:13", "HEB 4:12-13", "HEB 10:24-25", "JHN 3:16", "PRO 12:25", "2TI 4:7", "PSA 33:19-21", "1CO 11:23-25", "JAS 4:10", "PSA 27:1", "1TI 4:12", "PSA 73:26", "JAS 4:7-8", "MAL 3:8-10", "PRO 16:9", "MAT 7:7-11", "PRO 15:13", "JHN 15:4", "PSA 71:13-15", "PSA 119:11", "2KI 4:27-28", "ACT 2:25-27", "ISA 40:28-31", "GAL 6:7", "DEU 8:5", "PRO 17:22", "1JN 4:16", "COL 3:12", "EST 4:14", "HEB 13:8", "PHP 1:21", "MAT 8:6-10", "PSA 54:4", "JHN 15:9", "PRO 15:1", "ROM 15:4", "PHP 2:13", "PSA 150:6", "LUK 5:5-8", "PSA 62:1-2", "ISA 53:5", "PSA 18:30", "PSA 16:8", "HEB 4:12", "ROM 12:2", "GEN 1:1", "COL 3:17", "PSA 37:5", "PRO 10:19", "LUK 4:38-39", "PRO 16:18", "GAL 5:25", "MAT 5:13", "LUK 17:17", "EPH 3:17-19", "2CO 5:20", "PRO 4:7", "ACT 5:29", "1PE 5:7", "PRO 18:21", "2CO 10:5", "PSA 119:147", "ECC 9:4", "JHN 15:13", "PRO 1:7", "MAT 16:24", "ROM 1:16", "1TI 5:8", "MRK 5:18-19", "ROM 8:31", "PSA 100:4", "ACT 1:8", "PSA 37:9", "EXO 15:3", "PRO 24:5-6", "ISA 40:31", "PSA 91:11", "PSA 95:2", "REV 11:15", "EPH 4:32", "PSA 145:18", "ACT 2:1-4", "PSA 138:7", "PHP 4:13", "JOB 13:14-16", "PSA 32:8", "PSA 125:1", "PSA 55:22", "MAT 5:44", "JAS 1:2-3", "1JN 4:4", "JHN 14:27", "2TI 3:16-17", "ROM 8:5-6", "MAT 9:37-38", "MRK 11:24", "PSA 91:4", "EPH 4:29", "JHN 13:35", "GEN 2:7", "PRO 3:7-8", "MAT 4:19", "COL 2:12", "PHP 4:8", "PSA 86:11", "JOS 1:9", "1TH 4:1", "ROM 6:23", "ACT 4:30-31", "LUK 9:23", "PSA 119:43", "EPH 6:12", "MAT 12:20-22", "MAT 9:27-30", "COL 3:12-14", "ROM 8:24", "1CO 16:13-14", "MRK 3:1-5", "ISA 40:28", "PSA 130:7", "PSA 34:4", "JHN 13:34-35", "COL 1:13-14", "1CO 10:13", "PSA 103:1-5", "MAT 6:34", "PSA 40:1-3", "PRO 18:10", "1CO 13:1-8", "HEB 11:1", "PSA 30:5", "LUK 4:40-41", "REV 3:20", "MRK 10:27", "JHN 14:12", "2CO 3:17", "ROM 3:23-24", "PSA 147:11", "EPH 3:20", "ACT 3:2-8", "JHN 13:14-15", "MAL 3:10", "PSA 36:7", "JHN 20:31", "LUK 23:42", "PSA 119:9-11", "PRO 22:6", "ROM 12:1-2", "PSA 28:7", "PSA 23:4", "JAS 1:22", "EPH 6:13-18", "PHP 4:6", "ROM 12:18", "PSA 147:3", "JHN 14:6", "PSA 91:1-2", "ROM 8:28", "1JN 1:9", "1PE 2:24", "JOS 24:15", "PHP 1:6", "PSA 25:4-5", "PSA 107:19-21", "PSA 9:17-19", "2CO 4:7", "GEN 1:26", "PRO 30:5", "MAT 4:23-24", "JAS 1:5", "JHN 15:5", "PRO 3:5-6", "PSA 9:9-10", "COL 3:20", "NUM 13:30", "1CO 1:18", "PRO 13:12", "PRO 11:24-25", "2CO 4:8-9", "1TH 4:3-5", "GAL 5:1", "GAL 6:2", "EPH 5:15-16", "JAS 1:2-4", "PRO 27:18", "NUM 6:24-26", "PSA 84:5", "1SA 16:7", "PRO 17:17", "HEB 11:6", "ROM 5:8", "MAT 6:33", "ROM 12:10", "HEB 6:18-20", "MAT 18:20", "PRO 11:7", "LUK 10:27", "MAT 7:24", "MAT 10:1", "MAT 17:14-18", "1CO 16:13", "1PE 5:8", "PRO 16:24", "JAS 1:12", "1CO 13:8", "PSA 121:7-8", "PRO 20:7", "PSA 139:14", "COL 3:23", "PSA 18:2", "ECC 4:9-12", "ROM 4:18", "1PE 5:8-9", "JAS 5:14-15", "MAT 6:31-33", "PSA 118:6-9", "PSA 121:1-2", "MAT 17:20", "MRK 1:40-41", "EPH 2:12", "PSA 61:1-2", "ROM 5:3-5", "MIC 6:8", "PSA 115:11", "NEH 8:10", "PRO 24:14", "EPH 1:20-23", "PRO 27:17", "JHN 4:24", "LUK 18:1-8", "ROM 3:23", "PSA 31:19", "LUK 7:12-15", "PSA 112:7", "1TI 6:11-12", "LUK 6:31", "LUK 17:17-19", "MAT 19:26", "ROM 10:9-10", "JHN 8:12", "PHP 4:6-7", "PSA 65:5", "DEU 31:8", "LUK 9:23-24", "PSA 33:4", "JHN 8:31-32", "PRO 16:3", "LAM 3:20-22", "PSA 27:14", "MAT 7:7-8", "PSA 18:1", "JHN 16:13", "MAT 9:35", "ROM 8:37", "PSA 20:7", "1PE 1:3", "1CO 10:12-13", "PSA 91:1", "MAT 7:12", "PRO 4:23", "EPH 2:10", "PSA 119:105", "PSA 23:1", "1TH 5:16-18", "PSA 42:5", "2CO 6:14", "PSA 118:24", "DEU 31:6", "PSA 37:34", "2TI 1:7", "GAL 5:22-25", "REV 21:4-5", "PSA 84:11", "1TH 5:8", "JHN 1:12", "HEB 12:2", "EPH 6:10-18", "MAT 10:8", "1JN 4:19", "ROM 8:1", "PHP 4:19", "GEN 2:19", "MAT 25:21", "HEB 10:35-36", "MAT 7:24-25", "COL 3:2", "PHP 3:13-14", "EPH 4:11-13", "ROM 12:1", "1TI 4:8", "COL 1:23", "LUK 4:18-19", "EST 4:12-14", "EPH 6:10-11", "ROM 8:1-2", "MAT 28:19-20", "JER 14:22", "2CO 9:7", "EZK 37:10-12", "JHN 21:17", "ISA 43:19", "1TH 4:13", "MAT 6:24", "EPH 6:1-3", "1CO 15:57-58", "PSA 100:1-5", "GAL 6:9", "PSA 107:1", "PSA 1:1-3", "PSA 63:1", "2CO 12:9", "1CO 15:58", "GEN 2:18", "PHP 3:7-8", "JER 1:5", "JHN 15:12", "1CO 9:10", "MAT 4:4", "PRO 12:26", "PSA 127:2", "JER 29:11", "HEB 10:23-25", "JAS 1:19-20", "HEB 10:23", "MAT 6:14-15", "1PE 2:9", "TIT 2:11-12", "PSA 46:1", "JHN 10:11", "PRO 15:3", "PRO 11:25", "JOS 1:8", "PSA 37:4", "JHN 10:10", "PSA 91:2", "EXO 20:3-17", "EPH 5:25-26", "MAT 7:3-5", "2CH 7:14-15", "1JN 3:1", "PSA 31:24", "GEN 1:26-27", "PRO 19:21", "GEN 1:28", "1KI 17:13-16"];

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// FIXED epoch (not "Jan 1 of the current year") so the 458-day cycle
// runs continuously across year boundaries instead of restarting every
// New Year's -- this is what makes "cycle through the whole list before
// repeating" actually true rather than resetting partway through.
const VERSE_OF_DAY_EPOCH = '2026-01-01';

function verseOfDayIndex() {
  const diff = daysBetween(VERSE_OF_DAY_EPOCH, todayISODate());
  const len = VERSE_OF_DAY_LIST.length;
  return ((diff % len) + len) % len; // safe for any date, past or future
}

function todaysVerseRef() {
  return VERSE_OF_DAY_LIST[verseOfDayIndex()];
}

module.exports = { VERSE_OF_DAY_LIST, verseOfDayIndex, todaysVerseRef, VERSE_OF_DAY_EPOCH };
