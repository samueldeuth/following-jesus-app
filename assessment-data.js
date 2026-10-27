/* ============================================================
   Following Jesus — Spiritual Gifts & Five-Fold Office assessments
   ------------------------------------------------------------
   ALL wording lives in this one file: questions, gift/office guide
   copy, resource links, and the "best use" note. To change a
   question, edit its text here and re-upload this file only.

   Question IDs (e.g. "ADM-1") are what saved answers are keyed by —
   keep an ID the same when you only reword a question. If you ever
   change WHICH gift a question measures or add/remove questions,
   bump QUESTION_VERSION so old saved answers aren't mixed with new.

   Also loaded by Node for automated tests (see the module.exports
   at the bottom) — keep it plain JavaScript, no browser-only code.
   ============================================================ */
(function (root) {
  const QUESTION_VERSION = 2; // v2 (Oct 24, 2026): 15 statements reworded after the question review

  const SCALE = [
    { value: 1, label: 'Never true of me' },
    { value: 2, label: 'Rarely' },
    { value: 3, label: 'Sometimes' },
    { value: 4, label: 'Often' },
    { value: 5, label: 'Consistently true of me' }
  ];

  const BEST_USE_NOTE = {
    sections: [
      {
        heading: "You're growing, and your gifts can too.",
        body: "Following Jesus is a journey, not a fixed point. As you walk with Him, the Holy Spirit may use your life in new ways in different seasons. Don't see these results as permanent or final. You're in a beautiful flow with the Holy Spirit, so don't let an assessment box you in. The Spirit gives gifts \"just as he determines\" (1 Corinthians 12:11)."
      },
      {
        heading: "Let your pastor's voice be louder than this assessment.",
        body: "Spiritual gifts are imparted and observed in both the natural and the supernatural. Your pastor and those who serve in the five-fold offices can see what an assessment can't, and at times God uses them to impart a gift that wasn't there before. Paul reminded Timothy of the gift he received when the elders laid hands on him (1 Timothy 4:14; 2 Timothy 1:6), and he longed to impart a spiritual gift to the believers in Rome (Romans 1:11)."
      },
      {
        heading: "Your gifts are for building others up.",
        body: "Spiritual gifts aren't for show or for personal recognition. They're given to serve the body of Christ and build it up."
      }
    ],
    verses: [
      { text: "Each of you should use whatever gift you have received to serve others, as faithful stewards of God's grace in its various forms.", ref: '1 Peter 4:10' },
      { text: 'Now to each one the manifestation of the Spirit is given for the common good.', ref: '1 Corinthians 12:7' },
      { text: 'Since you are eager for gifts of the Spirit, try to excel in those that build up the church.', ref: '1 Corinthians 14:12' }
    ],
    closing: 'And without love, even the greatest gifts amount to nothing (1 Corinthians 13:1–2).'
  };

  /* ---------- Resource links shown on the results page ----------
     DEFAULT_RESOURCES show for everyone. Category keys below add
     gift-specific links under that gift's result. Edit freely. */
  const LINKS = {
    book: { label: 'Following Jesus: 7 Essentials', note: 'The book — including the Holy Spirit chapter', url: 'https://www.amazon.com/Following-Jesus-Essentials/dp/099800880X' },
    promotion: { label: 'The Process of Promotion', note: 'Online course', url: '/theprocessofpromotion' },
    preachingBook: { label: 'Preaching with Authority', note: 'Book — calling, character, and craft', url: 'https://www.amazon.com/gp/product/B0CVPX2ZRH' },
    preachingCourse: { label: 'Preaching Essentials', note: 'Online course', url: '/preaching-essentials-course' },
    discipleshipCourse: { label: 'Discipleship & Assimilation Essentials', note: 'Online course', url: '/discipleship-assimilation-essentials' },
    fjCourse: { label: 'Following Jesus Course', note: 'Free online course', url: '/course' },
    churchResources: { label: 'Church Discipleship Resources', note: 'followingjesusbook.com', url: 'https://followingjesusbook.com' }
  };
  const RESOURCES_BY_KEY = {
    // Spiritual gifts
    LEA: [LINKS.promotion], ADM: [LINKS.promotion],
    GIV: [LINKS.churchResources],
    EVA: [LINKS.book, LINKS.fjCourse],
    TEA: [LINKS.preachingCourse, LINKS.discipleshipCourse],
    EXH: [LINKS.discipleshipCourse],
    // Five-fold offices
    APO: [LINKS.preachingBook, LINKS.promotion],
    PRP: [LINKS.preachingBook],
    EVN: [LINKS.preachingBook, LINKS.book],
    PAS: [LINKS.preachingBook, LINKS.discipleshipCourse],
    TCH: [LINKS.preachingBook, LINKS.preachingCourse]
  };

  /* ---------- Assessment 1: Spiritual Gifts (18 gifts × 5) ----------
     Statement 5 in every set is the "others confirm" item, used to
     break ties between gifts with the same total. */
  const GIFTS = [
    { key: 'ADM', name: 'Administration', scripture: '1 Cor 12:28',
      description: "Paul lists \"guidance\" or \"administration\" among the gifts God has placed in the church (1 Cor 12:28). The Greek word pictures a ship's pilot steering the vessel safely to its destination. In Acts 6:1–7, the church appointed Spirit-filled people to organize the daily food distribution, and the word of God kept spreading.",
      functions: ['Turns vision into clear plans, steps, and timelines', 'Organizes people and resources so ministry runs well', 'Frees leaders to focus on prayer and the Word (Acts 6:4)', 'Brings order so that everything is done "in a fitting and orderly way" (1 Cor 14:40)'],
      questions: [
        'I can take a messy project and turn it into clear steps, owners, and deadlines so the church can move forward.',
        'When a ministry is wasting time or resources, I can usually see how to fix it.',
        'I enjoy building systems and schedules that make it easier for others to serve.',
        'I know how to hand tasks to the right people so the work gets done well.',
        'Leaders ask me to help plan or organize because they trust me with the details.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Luke 14:28',
        '1 Cor 14:40',
        'Acts 6:1–4',
        'Exod 18:21–22',
        '1 Cor 12:28'
      ] },
    { key: 'LEA', name: 'Leadership', scripture: 'Rom 12:8',
      description: 'Romans 12:8 tells the one whose gift is leading to do it diligently. Leadership is the God-given ability to see where God is going and to move people with Him. Nehemiah is a picture of this gift: he saw the need, cast the vision, and led the people to rebuild the wall (Neh 2:17–18).',
      functions: ["Hears God's direction and casts vision", 'Motivates and mobilizes people toward a shared goal', 'Makes hard decisions and takes responsibility', 'Raises up other leaders'],
      questions: [
        'I can see where God is leading a group and help people want to follow.',
        'When no one is leading, I step in and set direction.',
        'I\'m comfortable making the final call for a group, even when the decision isn\'t popular.',
        'I raise up the people around me, and the teams I lead become more fruitful.',
        'People look to me for direction, even when I don\'t have a title.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Neh 2:17–18',
        'Rom 12:8',
        'Josh 24:15',
        '2 Tim 2:2; John 15:8',
        'Heb 13:7'
      ] },
    { key: 'TEA', name: 'Teaching', scripture: 'Rom 12:7',
      description: "Teaching is the ability to explain God's Word clearly so people understand it and live it out (Rom 12:7). Ezra read the Law and made it clear so the people understood (Neh 8:8). Jesus' Great Commission includes \"teaching them to obey everything I have commanded you\" (Matt 28:20).",
      functions: ["Studies and rightly handles God's Word (2 Tim 2:15)", 'Explains truth simply so people understand and apply it', 'Grounds believers in sound doctrine', 'Guards the church from false teaching'],
      questions: [
        'I love digging into God\'s Word to understand what it means and how it fits together.',
        'I can explain a hard passage of Scripture so others clearly get it.',
        'It bothers me when God\'s Word is taught in a way that\'s unclear or inaccurate.',
        'When I teach, people put God\'s Word into practice and their lives change.',
        'People tell me I helped them understand the Bible in a way they never had before.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        '2 Tim 2:15',
        'Neh 8:8',
        'Titus 2:1',
        'Matt 28:20',
        'Rom 12:7'
      ] },
    { key: 'EXH', name: 'Exhortation / Encouragement', scripture: 'Rom 12:8',
      description: 'The word Paul uses in Romans 12:8 means to come alongside someone to strengthen, comfort, and urge them forward. Barnabas, whose name means "son of encouragement" (Acts 4:36), believed in Paul when others didn\'t, and later in John Mark too.',
      functions: ['Strengthens people who are discouraged or weary', 'Gives practical next steps to grow in following Jesus', 'Calls out what God has put in people', 'Lovingly challenges people who are stuck'],
      questions: [
        'I give people practical next steps to grow in following Jesus.',
        'When someone is discouraged, I know what to say to help them keep going.',
        'I see what God has put in people and tell them, even when they can\'t see it yet.',
        'I\'ll lovingly challenge someone who is stuck, even when I know it may be painful for them to hear.',
        'People leave time with me stronger in their faith and full of hope.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Heb 10:24',
        '1 Thess 5:11',
        'Acts 11:23',
        'Heb 3:13',
        'Acts 4:36'
      ] },
    { key: 'WIS', name: 'Word of Wisdom', scripture: '1 Cor 12:8',
      description: "A message of wisdom is given \"through the Spirit\" (1 Cor 12:8). It is Spirit-given insight into how to apply God's truth to a specific situation. Solomon's ruling between two mothers (1 Kings 3:16–28) and James's counsel at the Jerusalem council (Acts 15:13–21) show this gift at work.",
      functions: ["Sees God's way forward in confusing situations", 'Applies Scripture to real-life decisions', 'Brings resolution to conflict and complexity', 'Gives counsel that proves sound over time'],
      questions: [
        'In confusing situations, I often see God\'s way forward when others don\'t.',
        'I can apply God\'s Word to a specific, real-life decision with clarity.',
        'When I face difficulties or challenges, the Holy Spirit gives me insight and strategy to move forward.',
        'When people follow the counsel I give, it usually proves to be right.',
        'People come to me for advice when they\'re facing a hard decision.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        '1 Cor 12:8',
        'Ps 119:105',
        'Jas 1:5; Prov 2:6',
        '1 Kgs 3:28',
        'Prov 15:22'
      ] },
    { key: 'KNO', name: 'Word of Knowledge', scripture: '1 Cor 12:8',
      description: 'A message of knowledge comes "by means of the same Spirit" (1 Cor 12:8). It is the Holy Spirit revealing facts or truth that couldn\'t be known naturally. Jesus told the woman at the well about her five husbands, and she ran to tell her town (John 4:16–19, 29). Peter knew Ananias had lied about the money (Acts 5:3).',
      functions: ['Receives specific insight from the Holy Spirit about people or situations', 'Opens hearts by showing people that God sees them', 'Brings hidden things into the light', 'Directs prayer and ministry with precision'],
      questions: [
        'While praying for someone, the Holy Spirit has shown me details about their life I had no natural way of knowing.',
        'God has shown me something about a situation that was later confirmed to be true.',
        'When I pray about a situation, the Holy Spirit sometimes reveals the root issue, not just what others see on the surface.',
        'Something the Holy Spirit showed me has helped a person know God sees them.',
        'Others have confirmed that what God showed me about them was accurate.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'John 4:16–19',
        'Acts 5:3',
        '1 Cor 2:10; John 4:16–19',
        'John 1:47–49',
        '1 Cor 14:24–25'
      ] },
    { key: 'FAI', name: 'Faith', scripture: '1 Cor 12:9',
      description: 'Every believer has saving faith, but the gift of faith (1 Cor 12:9) is an unusual, Spirit-given confidence that God will do what seems impossible. Hebrews 11 is full of people who trusted God against all odds, and Jesus said faith as small as a mustard seed can move mountains (Matt 17:20).',
      functions: ['Believes God for the impossible and stays steady', 'Prays bold prayers and expects answers', 'Steps out in obedience before the way is clear', 'Builds faith in others during hard seasons'],
      questions: [
        'I believe God for things that look impossible, and circumstances don\'t easily shake me.',
        'When others are worried about a need, I\'m confident God will come through.',
        'I have stepped out in obedience to God when I couldn\'t see how it would work.',
        'I\'ve trusted God for the impossible and seen Him answer bold prayers of faith.',
        'People say my faith builds their faith when they\'re going through something hard.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Matt 17:20',
        'Phil 4:19',
        'Heb 11:8',
        'Heb 11:1; Mark 11:22–24',
        'Rom 1:12'
      ] },
    { key: 'DIS', name: 'Discerning of Spirits', scripture: '1 Cor 12:10',
      description: 'Distinguishing between spirits (1 Cor 12:10) is the Spirit-given ability to know whether something is from God, from human motives, or from the enemy. Paul discerned the spirit behind the slave girl who followed him in Philippi (Acts 16:16–18). John tells us to "test the spirits" (1 John 4:1).',
      functions: ["Senses what is from God and what isn't", 'Protects the church from deception and false teaching', 'Recognizes spiritual oppression so it can be confronted', 'Helps leaders make wise decisions about people and direction'],
      questions: [
        'I can often sense a person\'s real motives behind what they say or do.',
        'I notice when a teaching, person, or situation isn\'t right, even when everything looks fine.',
        'I\'m sensitive to what\'s happening spiritually in a room or a place.',
        'My cautions about a person or situation have later proved to be right.',
        'Leaders ask what I\'m sensing before they make decisions.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Acts 8:20–23; 1 John 4:1',
        '1 John 4:1',
        'Acts 16:16–18',
        '2 Cor 11:14',
        '1 Cor 12:10'
      ] },
    { key: 'PRO', name: 'Prophecy', scripture: 'Rom 12:6; 1 Cor 12:10',
      description: 'Prophecy is speaking a timely word from God. Paul says it "strengthens, encourages and comforts" (1 Cor 14:3), and he urges every believer to eagerly desire it (1 Cor 14:1). Agabus prophesied a famine so the church could prepare (Acts 11:28). All prophecy is tested against Scripture (1 Thess 5:20–21).',
      functions: ['Shares what God is saying at the right time', 'Builds up, encourages, and comforts people', "Calls people back to God's heart", 'Brings direction and confirmation to individuals and churches'],
      questions: [
        'God gives me a word, picture, or impression to share with someone at the right time.',
        'I feel compelled to speak up when I see God\'s people drifting from His heart.',
        'When I share what God has shown me, it builds people up, encourages them, or comforts them (1 Cor 14:3).',
        'Words I\'ve shared have proved accurate or come to pass.',
        'People tell me a word I gave was exactly what God was already speaking to them.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Joel 2:28',
        '2 Chr 24:19',
        '1 Cor 14:3',
        'Acts 11:28',
        '1 Thess 5:20–21'
      ] },
    { key: 'MER', name: 'Mercy', scripture: 'Rom 12:8',
      description: "Romans 12:8 tells the one who shows mercy to do it cheerfully. Mercy is God's compassion flowing through a person toward the hurting. Jesus was \"moved with compassion\" and healed the sick (Matt 14:14), and the Good Samaritan stopped for the man everyone else passed by (Luke 10:33–35).",
      functions: ['Notices people who are hurting, sick, or overlooked', 'Stays present with people in hard seasons', 'Shows practical kindness with joy', 'Reflects the compassion of Jesus to the broken'],
      questions: [
        'My heart is moved for the hurting, sick, and overlooked in a way that stays with me until I\'ve helped.',
        'I\'d rather stay beside someone who is hurting than rush to fix their problem.',
        'I\'m drawn to the people others avoid: the lonely, the grieving, the poor, the difficult.',
        'I often notice when someone is quietly hurting, and I cheerfully go out of my way to show them kindness.',
        'People who are hurting come to me because they know I\'ll care for them.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Matt 14:14',
        'Rom 12:15',
        'Luke 10:33–35',
        'Rom 12:8',
        'Col 3:12'
      ] },
    { key: 'SER', name: 'Serving / Helps', scripture: 'Rom 12:7; 1 Cor 12:28',
      description: 'Serving (Rom 12:7) and helping (1 Cor 12:28) are the gifts of meeting practical needs so the body of Christ can thrive. Peter says whoever serves should do it "with the strength God provides" (1 Pet 4:11). Jesus Himself came "not to be served, but to serve" (Mark 10:45).',
      functions: ['Sees practical needs and meets them', 'Serves faithfully behind the scenes', 'Frees leaders to focus on their calling', 'Makes ministry possible through reliability'],
      questions: [
        'I see practical needs before others do and just take care of them.',
        'I\'m happy serving behind the scenes where no one notices.',
        'I love freeing up leaders so they can focus on what God called them to do.',
        'I\'d rather help get something done than be the one leading it.',
        'People say they can always count on me when something needs to get done.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Acts 6:2–3',
        'Matt 6:3–4',
        'Exod 17:12',
        'Mark 10:45',
        '1 Pet 4:11'
      ] },
    { key: 'GIV', name: 'Giving', scripture: 'Rom 12:8',
      description: "Romans 12:8 tells the giver to give generously. Every believer is called to give, but the gift of giving is a Spirit-given joy and capacity to resource God's work. The Macedonian churches gave beyond their ability (2 Cor 8:1–5), and women like Joanna and Susanna supported Jesus' ministry from their own means (Luke 8:3).",
      functions: ['Gives generously and cheerfully beyond the tithe (2 Cor 9:7)', 'Manages resources to give more to the Kingdom', 'Meets needs the Holy Spirit highlights', 'Resources ministry and missions'],
      questions: [
        'I look for chances to give to God\'s work beyond my tithe.',
        'Giving generously brings me joy, not stress.',
        'I manage my money so I can give more to the Kingdom.',
        'God has prompted me to meet a specific need, and I followed through.',
        'People or ministries have told me my gift came at exactly the right time.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        '2 Cor 8:3',
        '2 Cor 9:7',
        'Luke 16:10–11',
        'Acts 4:34–35',
        'Phil 4:18'
      ] },
    { key: 'HOS', name: 'Hospitality', scripture: '1 Pet 4:9',
      description: 'Peter tells believers to offer hospitality without grumbling (1 Pet 4:9). The Greek word means "love of strangers." Lydia opened her home to Paul and his team (Acts 16:15), and the early church met and ate together in homes (Acts 2:46).',
      functions: ['Welcomes newcomers and strangers', 'Opens homes and creates spaces where people feel cared for', 'Builds community around the table', 'Helps people feel they belong in the body of Christ'],
      questions: [
        'I love opening my home to people, including people I don\'t know well.',
        'Walking up to someone at church I don\'t know and making them feel welcome comes naturally to me.',
        'I enjoy getting a space or a meal ready so people feel cared for.',
        'Having people over gives me energy more than it drains me.',
        'People tell me they feel at home and accepted when they\'re with me.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Rom 12:13',
        'Heb 13:2',
        'Acts 16:15',
        '1 Pet 4:9',
        'Acts 2:46'
      ] },
    { key: 'EVA', name: 'Evangelism', scripture: 'Eph 4:11; Acts 21:8',
      description: 'Every follower of Jesus is a witness (Acts 1:8), but some carry a special grace to share the gospel so people respond. Philip shared Jesus with the Ethiopian official, who believed and was baptized that day (Acts 8:35–38).',
      functions: ['Turns everyday conversations toward Jesus', 'Shares the gospel clearly and naturally', 'Builds friendships with people far from God', 'Leads people to put their faith in Jesus'],
      questions: [
        'I regularly turn everyday conversations toward Jesus.',
        'I\'m comfortable sharing the gospel with people who don\'t know Jesus.',
        'I\'m intentional about building friendships with people who don\'t know Jesus, believing I\'ll get to lead them to Christ.',
        'I have led people to put their faith in Jesus.',
        'Others say I make talking about Jesus feel natural.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Col 4:6',
        'Rom 1:16',
        '1 Cor 9:22; Luke 19:10',
        'Acts 8:35–38',
        '2 Tim 4:5'
      ] },
    { key: 'HEA', name: 'Healing', scripture: '1 Cor 12:9',
      description: 'Paul lists "gifts of healing" given by the one Spirit (1 Cor 12:9). God anointed Jesus with the Holy Spirit and power, and He went around healing (Acts 10:38). Jesus sent His followers to do the same (Mark 16:17–18), and Peter and John saw a lame man walk in Jesus\' name (Acts 3:6–8).',
      functions: ['Prays for the sick in faith, often with laying on of hands', 'Is led by the Holy Spirit to pray for specific needs', 'Sees physical, emotional, and spiritual healing', 'Points people to Jesus as the healer'],
      questions: [
        'When I\'m with someone who is sick, I feel faith rise up in me for their healing.',
        'When someone is sick, I\'m quick to offer to pray for them right then.',
        'The Holy Spirit has led me to pray for a specific sickness or injury.',
        'I have seen people healed after I prayed in Jesus\' name.',
        'People ask me specifically to pray for their healing.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Mark 16:18',
        'Jas 5:14–15',
        'Acts 14:9–10',
        'Acts 3:6–8',
        '1 Cor 12:9'
      ] },
    { key: 'MIR', name: 'Miracles', scripture: '1 Cor 12:10',
      description: 'Miraculous powers (1 Cor 12:10) are the Spirit\'s power to do what only God can do. God did extraordinary miracles through Paul (Acts 19:11), and the early church prayed for signs and wonders in the name of Jesus (Acts 4:30).',
      functions: ['Expects and prays for God to move supernaturally', 'Sees God intervene beyond natural explanation', 'Confirms the gospel through signs and wonders (Mark 16:20)', 'Builds faith that God is still at work today'],
      questions: [
        'I\'m bold to ask God for a miracle rather than only praying for comfort.',
        'I have seen God step in where there was no natural explanation.',
        'The Holy Spirit has led me to pray for something only God could do.',
        'I\'ve seen God move in power when I stepped out in obedience and prayed.',
        'Others have seen and confirmed miracles connected to my prayers.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Acts 4:30',
        'Acts 19:11',
        'Eph 3:20',
        'Mark 16:20; Acts 3:6–8',
        'Gal 3:5'
      ] },
    { key: 'INT', name: 'Interpretation of Tongues', scripture: '1 Cor 12:10',
      description: 'Interpretation (1 Cor 12:10) makes a message given in tongues understandable to the church, so everyone is built up. Paul says that anyone who speaks in a tongue should pray for the power to interpret (1 Cor 14:13), and that interpreted tongues build up the church like prophecy does (1 Cor 14:5).',
      functions: ['Senses what God is saying through a message in tongues', 'Makes that message clear so the church is built up', 'Brings order to public use of the gifts (1 Cor 14:27)', 'Encourages and strengthens those who hear'],
      questions: [
        'When someone speaks in tongues, I sometimes sense what God is saying.',
        'I have shared the meaning of a message in tongues so the church could understand it.',
        'I ask God for the ability to interpret, as Paul tells us to (1 Cor 14:13).',
        'Interpretations I\'ve given have built up and encouraged the people who heard them.',
        'Leaders have affirmed that my interpretations were from God.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        '1 Cor 12:10',
        '1 Cor 14:5',
        '1 Cor 14:13',
        '1 Cor 14:26',
        '1 Cor 14:27–29'
      ] },
    { key: 'ICS', name: 'Intercession', scripture: 'Rom 8:26; Col 4:12',
      description: 'Every believer is called to pray, but some carry a special burden to stand in the gap for others. Epaphras was "always wrestling in prayer" for the church (Col 4:12), and Anna worshiped night and day with fasting and prayer (Luke 2:37). The Holy Spirit helps us pray when we don\'t know how (Rom 8:26).',
      functions: ['Prays for long periods with persistence', 'Carries a God-given burden for people, churches, and nations', 'Sees clear, specific answers to prayer', 'Covers leaders and ministries in prayer'],
      questions: [
        'I can pray for long stretches and lose track of time.',
        'God puts a burden on me to pray for people, situations, or nations, and I keep praying until I sense a release.',
        'Prayer is one of the main ways I serve others.',
        'I regularly see clear, specific answers to my prayers.',
        'People come to me first when they need someone to pray.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Luke 6:12',
        'Col 4:12',
        '1 Tim 2:1',
        'Jas 5:16',
        'Luke 2:37'
      ] }
  ];

  /* ---------- Assessment 2: Five-Fold Office (5 offices × 10) ----------
     Built on the Path framework from Preaching with Authority.
     Statement 10 in every set is the "others confirm" tie-breaker. */
  const OFFICES = [
    { key: 'APO', name: 'Apostle', path: 'Clears and reveals the Path', scripture: 'Rom 15:20; 1 Cor 3:10',
      description: '"Apostle" means "sent one." Jesus is called "the apostle and high priest of our faith" (Heb 3:1), the one sent by the Father. Paul described himself as a wise builder laying a foundation (1 Cor 3:10), and his ambition was to preach Christ where He wasn\'t yet known (Rom 15:20). Apostles pioneer new works, establish churches, and set leaders in place, as Paul and Barnabas did on their journeys (Acts 14:21–23).',
      functions: ['Pioneers new churches, ministries, and territory for the gospel', 'Lays foundations of vision, values, and structure', 'Raises up and sends leaders', 'Sees the big picture and keeps the church moving on mission', 'Provides oversight and covering for other leaders'],
      questions: [
        'I\'m energized by starting new things for the Kingdom: churches, ministries, groups, or outreaches.',
        'I think about the big picture and where God is taking His Church next.',
        'I get restless when things stay the same for too long.',
        'I feel pulled to take the gospel where Jesus isn\'t known yet.',
        'I raise up leaders and build teams so the work can grow beyond me.',
        'I can lay a foundation of vision, values, and structure that others build on (1 Cor 3:10).',
        'I\'d rather pioneer something new than improve something that already exists.',
        'Things I\'ve started are still going and growing without me.',
        'Leaders from other ministries look to me for direction and covering.',
        'People describe me as a pioneer or a builder.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Rom 15:20',
        'Acts 1:8',
        'Acts 16:9–10',
        '2 Cor 10:16',
        'Acts 14:23',
        '1 Cor 3:10',
        'Rom 15:20',
        '1 Cor 3:6',
        '2 Cor 11:28',
        'Eph 2:20'
      ] },
    { key: 'PRP', name: 'Prophet', path: 'Calls people back to the Path', scripture: 'Jer 6:16; 1 Cor 14:3',
      description: "Prophets speak God's heart to His people and call them back to Him. Through Jeremiah, God told His people to stand at the crossroads and ask for the ancient paths, where the good way is (Jer 6:16). In the New Testament, prophets like Judas and Silas spoke to encourage and strengthen the believers (Acts 15:32), and prophets and teachers together heard the Holy Spirit send out Barnabas and Saul (Acts 13:1–3).",
      functions: ['Hears and speaks what God is saying in this season', 'Calls the church back to intimacy with God, holiness, and obedience', 'Exposes drift, compromise, and injustice', 'Brings direction and confirmation to leaders and churches', 'Keeps the church sensitive to the Holy Spirit'],
      questions: [
        'When people, churches, or nations wander from God\'s path, I\'m compelled to call them back.',
        'I sense what God is saying in this season and feel responsible to share it.',
        'I care more about obeying God than keeping everyone comfortable.',
        'I notice when our worship, values, or way of living have drifted from God\'s heart.',
        'I call people back to closeness with God, holiness, and obedience.',
        'God gives me dreams, pictures, or impressions about the direction of a church or a person.',
        'I speak up about sin and compromise, even when it costs me.',
        'Words or warnings I\'ve given about a church or leader have proved true.',
        'What I\'ve shared has led leaders or ministries to turn back toward God.',
        'People call me prophetic, whether they welcome it or not.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Jer 6:16; Ezek 33:7',
        'Amos 3:7',
        'Gal 1:10',
        'Rev 2:4–5',
        'Hos 6:1',
        'Acts 2:17',
        'Isa 58:1',
        'Deut 18:22',
        'Acts 15:32',
        'Acts 13:1'
      ] },
    { key: 'EVN', name: 'Evangelist', path: 'Brings new people onto the Path', scripture: 'Luke 19:10; Acts 8:5, 21:8',
      description: 'Philip is the only person the Bible names as an evangelist (Acts 21:8). He preached Christ in Samaria, and the whole city was filled with joy as people believed and were baptized (Acts 8:5–12). Then he followed the Spirit to one man on a desert road and led him to Jesus (Acts 8:26–38). Paul told Timothy to "do the work of an evangelist" (2 Tim 4:5). The evangelist carries the heart of Jesus, who came "to seek and to save the lost" (Luke 19:10).',
      functions: ['Proclaims the gospel and calls people to follow Jesus', 'Keeps the church focused on the lost', 'Trains and stirs up believers to share their faith', 'Brings new people into the life of the church', 'Often sees the gospel confirmed with signs and wonders (Acts 8:6)'],
      questions: [
        'I think about people who don\'t know Jesus far more than most believers I know.',
        'I\'m more at ease around people far from God than many Christians are.',
        'It frustrates me when church activity crowds out reaching the lost.',
        'I can share the gospel simply and clearly with almost anyone.',
        'When I share Jesus with people, I invite them to follow Him, and I expect them to say yes.',
        'I train and stir up other believers to share their faith.',
        'I\'m regularly bringing new people into church.',
        'Many people have come to faith in Jesus through my witness.',
        'When I share the gospel, people often respond right then.',
        'Others say my passion for the lost is contagious.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Luke 19:10',
        'Luke 15:1–2',
        'Luke 15:4',
        '1 Cor 15:3–4',
        'Acts 2:38–41',
        'Eph 4:11–12',
        'John 1:41–42',
        'Acts 8:12',
        'Acts 8:36',
        '2 Tim 4:5'
      ] },
    { key: 'PAS', name: 'Pastor', path: 'Walks with people on the Path', scripture: 'John 10:11; 1 Pet 5:2',
      description: '"Pastor" means "shepherd." Jesus is the Good Shepherd who knows His sheep and lays down His life for them (John 10:11, 14). Peter told the church\'s elders to shepherd God\'s flock willingly and by example, not for gain (1 Pet 5:2–3). Paul told the Ephesian elders to keep watch over the flock and protect it from wolves (Acts 20:28–29).',
      functions: ["Cares for the spiritual health of God's people over the long haul", 'Notices those who are struggling or drifting and goes after them (Luke 15:4)', 'Protects the church from false teaching and harm', 'Builds healthy community and unity', "Walks with people through life's seasons toward maturity in Christ"],
      questions: [
        'I care deeply about how the people around me are doing with God.',
        'I notice when someone is missing, struggling, or drifting away.',
        'I\'d rather build deep, lasting community than create moments of motivation and inspiration.',
        'I\'m patient with people who are slow to grow.',
        'I stay with people over months and years, not just in a crisis.',
        'I help people work through conflict and be reconciled.',
        'I protect people from false teaching, harmful influences, and burnout.',
        'People I\'ve walked with are now steady and growing in Jesus.',
        'People call me first when they\'re going through something hard.',
        'Others call me a shepherd, or a spiritual mother or father.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        '1 Pet 5:2',
        'Luke 15:4',
        'Acts 2:42–47; John 10:14',
        '1 Thess 5:14',
        'John 10:11',
        'Matt 5:9',
        'Acts 20:28–29',
        'Col 1:28',
        'Gal 6:2',
        '1 Cor 4:15'
      ] },
    { key: 'TCH', name: 'Teacher', path: 'Shows people how to walk on the Path', scripture: 'Matt 28:20; 2 Tim 2:2',
      description: "Jesus taught with authority, and the crowds were amazed (Matt 7:28–29). He commanded His followers to teach new disciples to obey everything He commanded (Matt 28:20). Apollos was mighty in the Scriptures and taught accurately about Jesus (Acts 18:24–25), and Paul told Timothy to pass what he'd learned on to faithful people who could teach others (2 Tim 2:2).",
      functions: ["Explains God's Word with clarity and accuracy", "Grounds believers in sound doctrine so they aren't tossed around (Eph 4:14)", 'Builds discipleship pathways, studies, and courses', 'Trains others to teach', 'Shows people how to live out the truth day to day'],
      questions: [
        'I love studying God\'s Word and digging deep into what it means.',
        'I want people to understand why we believe what we believe, not just what.',
        'It bothers me when teaching is shallow, unclear, or off from Scripture.',
        'I enjoy organizing truth into clear outlines, steps, or lessons.',
        'I can make deep truths simple without making them shallow.',
        'I create or teach discipleship studies, classes, or courses.',
        'I train others so they can teach too (2 Tim 2:2).',
        'People I\'ve taught are grounded in God\'s Word and living it out.',
        'I help people connect what the Bible says to how they live Monday through Saturday.',
        'Others say I helped them finally understand God\'s Word.'
      ],
      // Scripture basis for each statement above, in the same order.
      refs: [
        'Ezra 7:10',
        '1 Pet 3:15',
        '2 Tim 4:3',
        'Luke 1:3',
        'Neh 8:8',
        'Matt 28:20',
        '2 Tim 2:2',
        'Eph 4:14',
        'Jas 1:22',
        'Matt 7:28–29'
      ] }
  ];

  const ASSESSMENTS = {
    gifts: {
      type: 'gifts',
      path: '/spiritual-gifts-assessment',
      title: 'Spiritual Gifts Assessment',
      shortTitle: 'Spiritual Gifts',
      minutes: 15,
      categories: GIFTS,
      confirmIndex: 4, // 0-based index of the "others confirm" question
      topCount: 3,
      bands: [ // min score (inclusive) per band, out of 25
        { min: 21, label: 'Strong' }, { min: 16, label: 'Developing' },
        { min: 11, label: 'Supporting' }, { min: 0, label: 'Not primary right now' }
      ],
      intro: "God has given every follower of Jesus spiritual gifts to build up His Church. This isn't a test you pass or fail. Answer honestly about what's true in your life right now, and let this be a starting point for seeking God about how He's made you.",
      footnote: "Tongues isn't part of this assessment because it's available to every Spirit-filled believer (Acts 2:4; 1 Corinthians 14:5). The Holy Spirit chapter of Following Jesus: 7 Essentials walks through it."
    },
    fivefold: {
      type: 'fivefold',
      path: '/five-fold-office-assessment',
      title: 'Five-Fold Office Assessment',
      shortTitle: 'Five-Fold Office',
      minutes: 8,
      categories: OFFICES,
      confirmIndex: 9,
      topCount: 2,
      // One extra question on the last page: the role they naturally take in
      // a group. Breaks exact ties and shows on the results page.
      groupRole: {
        id: 'ROLE',
        prompt: 'When you\'re part of a group or team, which role do you most naturally take?',
        options: [
          { key: 'APO', label: 'I start something new and point the way forward.' },
          { key: 'PRP', label: 'I call people back to what God is saying.' },
          { key: 'EVN', label: 'I bring new people in.' },
          { key: 'PAS', label: 'I make sure everyone is cared for and connected.' },
          { key: 'TCH', label: 'I explain things so everyone understands.' }
        ],
        ref: 'Eph 4:11–13; 1 Cor 12:18'
      },
      bands: [ // out of 50
        { min: 42, label: 'Strong' }, { min: 32, label: 'Developing' },
        { min: 22, label: 'Supporting' }, { min: 0, label: 'Not primary right now' }
      ],
      intro: "Jesus gave apostles, prophets, evangelists, pastors, and teachers to equip His people and build up His Church (Ephesians 4:11–13). Every follower of Jesus can share their faith, encourage others, and speak truth, but not everyone is called into one of these five leadership roles. This assessment will help you see which one or two you lean toward right now. Calling is delegated by the Holy Spirit, affirmed in community, and confirmed or released by those who already serve in these offices, so treat this as a starting point and invite your pastor to confirm your results.",
      footnote: 'The five offices lead and mature the church along the Path: the Apostle clears and reveals it, the Prophet calls people back to it, the Evangelist brings new people onto it, the Pastor walks with people on it, and the Teacher shows people how to walk on it.'
    }
  };

  /* ---------- Logic (pure functions, covered by tests) ---------- */

  function questionId(categoryKey, index) { return categoryKey + '-' + (index + 1); }

  // Round-robin order: question 1 of every category, then question 2 of
  // every category, and so on — so no gift's questions sit together.
  // Deterministic, so pages and saved progress always line up.
  function buildQuestionOrder(type) {
    const a = ASSESSMENTS[type];
    const perCategory = a.categories[0].questions.length;
    const order = [];
    for (let qi = 0; qi < perCategory; qi++) {
      a.categories.forEach((cat) => {
        order.push({ id: questionId(cat.key, qi), categoryKey: cat.key, text: cat.questions[qi] });
      });
    }
    return order;
  }

  // 0 = "Haven't had the chance yet" (NOT_YET); 1–5 = the rating scale.
  const NOT_YET = 0;
  const NOT_YET_LABEL = "Haven't had the chance yet";
  function isValidAnswer(v) { return Number.isInteger(v) && v >= 0 && v <= 5; }
  function isRated(v) { return Number.isInteger(v) && v >= 1 && v <= 5; }

  // answers: { "ADM-1": 4, "ADM-2": 0, ... }.
  // Each category is scored from the statements the person could rate,
  // then scaled to the full range (5–25 gifts, 10–50 five-fold), so a
  // "Haven't had the chance yet" never counts against them. A category
  // with nothing rated scores 0 and ranks last ("Not enough answers yet").
  // Ranking uses the unrounded average, then the "others confirm" item,
  // then definition order. Returns notYet counts per category too.
  function scoreAnswers(type, answers) {
    const a = ASSESSMENTS[type];
    const scores = {};
    const avg = {};
    const confirm = {};
    const notYet = {};
    let answered = 0;
    let total = 0;
    a.categories.forEach((cat) => {
      let sum = 0, rated = 0, na = 0;
      cat.questions.forEach((_, qi) => {
        total++;
        const v = answers ? answers[questionId(cat.key, qi)] : undefined;
        if (isValidAnswer(v)) answered++;
        if (isRated(v)) { sum += v; rated++; }
        else if (v === NOT_YET) na++;
      });
      const n = cat.questions.length;
      avg[cat.key] = rated ? sum / rated : -1;
      scores[cat.key] = rated ? Math.round((sum / rated) * n) : 0;
      notYet[cat.key] = na;
      const c = answers ? answers[questionId(cat.key, a.confirmIndex)] : undefined;
      confirm[cat.key] = isRated(c) ? c : 0;
    });
    const definitionOrder = a.categories.map((c) => c.key);
    const role = a.groupRole && answers ? answers[a.groupRole.id] : undefined;
    const roleValid = !a.groupRole || a.groupRole.options.some((o) => o.key === role);
    const ranked = definitionOrder.slice().sort((x, y) =>
      (avg[y] - avg[x]) ||
      ((y === role ? 1 : 0) - (x === role ? 1 : 0)) ||
      (confirm[y] - confirm[x]) ||
      (definitionOrder.indexOf(x) - definitionOrder.indexOf(y))
    );
    const notYetTotal = Object.values(notYet).reduce((t, v) => t + v, 0);
    return { scores, ranked, answered, total, complete: answered === total && roleValid, notYet, notYetTotal, groupRole: roleValid && a.groupRole ? role : null };
  }

  // How many "Haven't had the chance yet" answers per category (for notes on saved results).
  function notYetCounts(type, answers) {
    const out = {};
    ASSESSMENTS[type].categories.forEach((cat) => {
      out[cat.key] = cat.questions.filter((_, qi) => answers && answers[questionId(cat.key, qi)] === NOT_YET).length;
    });
    return out;
  }

  // A score is "thin" when at least 40% of that category's statements were
  // answered "Haven't had the chance yet" (2 of 5 gifts, 4 of 10 five-fold).
  function isThin(type, naCount) {
    const n = ASSESSMENTS[type].categories[0].questions.length;
    return naCount >= Math.ceil(n * 0.4);
  }

  function maxScore(type) {
    const a = ASSESSMENTS[type];
    return a.categories[0].questions.length * 5;
  }

  function bandFor(type, score) {
    const bands = ASSESSMENTS[type].bands;
    // Below the lowest possible rated score = nothing could be rated yet.
    if (score < ASSESSMENTS[type].categories[0].questions.length) return 'Not enough answers yet';
    for (const b of bands) if (score >= b.min) return b.label;
    return bands[bands.length - 1].label;
  }

  function categoryByKey(type, key) {
    return ASSESSMENTS[type].categories.find((c) => c.key === key) || null;
  }

  function resourcesFor(key) { return RESOURCES_BY_KEY[key] || []; }

  const api = {
    QUESTION_VERSION, SCALE, BEST_USE_NOTE, LINKS, ASSESSMENTS, NOT_YET, NOT_YET_LABEL,
    questionId, buildQuestionOrder, isValidAnswer, isRated, scoreAnswers, notYetCounts, isThin, maxScore,
    bandFor, categoryByKey, resourcesFor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FJ_ASSESSMENT = api;
})(typeof window !== 'undefined' ? window : this);
