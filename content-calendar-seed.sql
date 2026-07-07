-- Content calendar tracker for the Instagram/Facebook/Pinterest roadmap.
-- Run this once in the Supabase SQL editor, then the Content Calendar tab
-- in /admin.html will show every planned post with a checkbox and due date.

create table if not exists content_posts (
  id          bigserial primary key,
  week_number int not null,
  product     text not null,
  platform    text not null,
  post_type   text not null,
  caption     text not null,
  due_date    date,
  posted      boolean not null default false,
  posted_at   timestamptz,
  created_at  timestamptz not null default now()
);

alter table content_posts enable row level security;

insert into content_posts (week_number, product, platform, post_type, caption) values

-- Week 0: one-time setup
(0, 'Instagram Intro Post', 'Instagram', 'Intro', $$I'm Mel Cooper, and I started Find Your Compass Within because I kept meeting people who were successful on paper and stuck everywhere else.

Before this, I spent eight years in recruitment. I sat across from hundreds of capable people trying to figure out their next move, and I noticed the same thing over and over. The stuck feeling was almost never about skills or opportunities. It was about something underneath that nobody had helped them look at.

I'm a certified life coach now, and I built this practice around a simple idea: I'm not here to fix you or hand you a five-step plan. I'm here to hold space while you find your own way through, using what's already in you.

This page will be honest, grounded, and useful. No unlocking your potential. No transformational journey. Just real tools for people who are ready to stop feeling stuck.

Glad you're here.

Hashtags: #lifecoaching #findyourcompasswithin #innerwork #personaldevelopment$$),

(0, 'Facebook Intro Post', 'Facebook', 'Intro', $$Hi, I'm Mel Cooper, founder of Find Your Compass Within.

For eight years I worked in recruitment, which meant I spent thousands of hours talking to people about their careers. What I learned is that most people who feel stuck aren't missing information. They're missing clarity about who they actually are underneath the roles they play.

That's what led me to life coaching, and to building this practice. I work with the whole person, mind, heart, and spirit, using grounded methods rather than vague inspiration. My approach rests on three ideas: hold, don't fix. The wound often points to the path. Nature teaches what offices can't.

I've built a full set of workbooks and coaching resources for the specific places people get stuck: confidence, boundaries, money, identity, motherhood, re-entry after a break, and more. I'll be sharing pieces of that here, along with the thinking behind it.

If you've been feeling directionless and can't quite name why, you're in the right place.$$),

(0, 'Pinterest Boards', 'Pinterest', 'Setup', $$Create these 8 boards before pinning anything: Life Coaching Tips, Career Clarity & Direction, Confidence & Self-Worth, Boundaries & Saying No, Motherhood & Identity, Perimenopause & Midlife, Money Mindset, Journal Prompts & Self-Reflection.$$),

-- Week 1: Compass Check-In (free lead magnet)
(1, 'Compass Check-In', 'Instagram + Facebook', 'Teaser', $$There's a question I ask almost every client in the first session, and it's not what you'd expect. It's not 'what do you want.' It's 'what have you stopped looking at.'$$),
(1, 'Compass Check-In', 'Instagram + Facebook', 'Value', $$Share one of the eight life areas the Check-In covers, without giving away the tool. E.g. Boundaries are one of eight areas I ask people to rate honestly. Most people guess theirs is fine. Most are wrong.$$),
(1, 'Compass Check-In', 'Instagram + Facebook', 'Link-out', $$I built a free tool for this. Ten minutes, eight areas, no login required. Link in bio. Drives to the blog post, which links to the Check-In.$$),
(1, 'Compass Check-In', 'Pinterest', 'Pins', $$Pin title: Free Life Assessment: 8 Areas of Your Life Rated Honestly.
Description: Feeling stuck but can't name why? This free 10-minute check-in rates 8 key life areas so you can see exactly where to focus. No login required.$$),

-- Week 2: Compass Workbook
(2, 'Compass Workbook', 'Instagram + Facebook', 'Teaser', $$Not every stuck area matters equally. One of them is usually holding the rest hostage.$$),
(2, 'Compass Workbook', 'Instagram + Facebook', 'Value', $$Explain the ripple effect concept, one real (anonymized or hypothetical) example.$$),
(2, 'Compass Workbook', 'Instagram + Facebook', 'Link-out', $$Link to the blog post on findyourcompasswithin.com, which links to the workbook.$$),
(2, 'Compass Workbook', 'Pinterest', 'Pins', $$Pin title: The One Area Holding Your Whole Life Back.
Description: A guided workbook to find the single stuck area creating a ripple effect through everything else in your life.$$),

-- Week 3: Chart Your Course
(3, 'Chart Your Course', 'Instagram + Facebook', 'Teaser', $$Most direction problems aren't direction problems. They're fear wearing a disguise.$$),
(3, 'Chart Your Course', 'Instagram + Facebook', 'Value', $$Talk about ego-driven vs. soul-aligned decisions.$$),
(3, 'Chart Your Course', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(3, 'Chart Your Course', 'Pinterest', 'Pins', $$Pin title: Make Decisions From Clarity, Not Fear.
Description: A workbook for separating fear-driven choices from soul-aligned ones, so you can finally choose with confidence.$$),

-- Week 4: Discovery Bundle
(4, 'Discovery Bundle', 'Instagram + Facebook', 'Teaser', $$The question I get asked most isn't 'what should I do.' It's 'where do I even start.'$$),
(4, 'Discovery Bundle', 'Instagram + Facebook', 'Value', $$Position the bundle as the answer to overwhelm, not more content to consume.$$),
(4, 'Discovery Bundle', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(4, 'Discovery Bundle', 'Pinterest', 'Pins', $$Pin title: Feeling Stuck Everywhere? Start Here.
Description: A complete bundle for people who don't know where to begin. Structured self-discovery without the overwhelm.$$),

-- Week 5: Still Me
(5, 'Still Me', 'Instagram + Facebook', 'Teaser', $$Somewhere between all the roles you play, is there still a you underneath?$$),
(5, 'Still Me', 'Instagram + Facebook', 'Value', $$Normalize the disorientation of losing yourself to roles (parent, employee, partner) without pathologizing it.$$),
(5, 'Still Me', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(5, 'Still Me', 'Pinterest', 'Pins', $$Pin title: Who Are You Underneath All Your Roles?
Description: A workbook for reconnecting with your identity beneath the roles of parent, partner, and employee.$$),

-- Week 6: The Mother Behind the Role
(6, 'The Mother Behind the Role', 'Instagram + Facebook', 'Teaser', $$Nobody warns you that you can love your children completely and still miss yourself.$$),
(6, 'The Mother Behind the Role', 'Instagram + Facebook', 'Value', $$One grounded parenting-psychology fact from the workbook (e.g. attachment, co-regulation) reframed for the mother, not just the child.$$),
(6, 'The Mother Behind the Role', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(6, 'The Mother Behind the Role', 'Pinterest', 'Pins', $$Pin title: Motherhood Doesn't Have to Erase You.
Description: Evidence-based reflection workbook for mothers who feel like they've disappeared into the role.$$),

-- Week 7: The Perimenopause Pivot
(7, 'The Perimenopause Pivot', 'Instagram + Facebook', 'Teaser', $$Perimenopause gets talked about like an ending. Biologically, it's the opposite.$$),
(7, 'The Perimenopause Pivot', 'Instagram + Facebook', 'Value', $$The grandmother hypothesis content from your own workbook. This is genuinely strong, evidence-based material.$$),
(7, 'The Perimenopause Pivot', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(7, 'The Perimenopause Pivot', 'Pinterest', 'Pins', $$Pin title: Perimenopause Is Not the End, It's a Pivot.
Description: A grounded, research-backed guide reframing perimenopause as a season of purpose, not decline.$$),

-- Week 8: Fear Audit
(8, 'Fear Audit', 'Instagram + Facebook', 'Teaser', $$Fear isn't the enemy. But it's not always right either.$$),
(8, 'Fear Audit', 'Instagram + Facebook', 'Value', $$Distinguish protective fear from limiting fear, one concrete example each.$$),
(8, 'Fear Audit', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(8, 'Fear Audit', 'Pinterest', 'Pins', $$Pin title: Is Your Fear Protecting You or Controlling You?
Description: Learn to tell the difference between fear that keeps you safe and fear that keeps you small.$$),

-- Week 9: Confidence Code
(9, 'Confidence Code', 'Instagram + Facebook', 'Teaser', $$Confidence isn't something people have or don't have. It's something people practice or stop practicing.$$),
(9, 'Confidence Code', 'Instagram + Facebook', 'Value', $$Reframe confidence as a skill, not a trait.$$),
(9, 'Confidence Code', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(9, 'Confidence Code', 'Pinterest', 'Pins', $$Pin title: Confidence Is a Skill, Not a Personality Trait.
Description: A workbook to rebuild confidence through practice, not personality.$$),

-- Week 10: Money Mindset
(10, 'Money Mindset', 'Instagram + Facebook', 'Teaser', $$Your bank balance and your self-worth got tangled up somewhere. Usually a long time ago.$$),
(10, 'Money Mindset', 'Instagram + Facebook', 'Value', $$One honest, non-preachy observation about money and identity.$$),
(10, 'Money Mindset', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(10, 'Money Mindset', 'Pinterest', 'Pins', $$Pin title: What Your Relationship With Money Says About Your Worth.
Description: Untangle self-worth from bank balance with this guided money mindset workbook.$$),

-- Week 11: Strength Finder
(11, 'Strength Finder', 'Instagram + Facebook', 'Teaser', $$Most strength assessments measure what you're good at. Almost none ask what you're supposed to be good at, and how different that list actually is.$$),
(11, 'Strength Finder', 'Instagram + Facebook', 'Value', $$Distinguish inherited strengths (what you were praised for as a kid) from real strengths.$$),
(11, 'Strength Finder', 'Instagram + Facebook', 'Link-out', $$Blog link.$$),
(11, 'Strength Finder', 'Pinterest', 'Pins', $$Pin title: What Are You Actually Good At?
Description: Discover your real strengths, not the ones you were praised for as a child.$$),

-- Week 12: Boundary Blueprint / Re-Entry Workbook (double week)
(12, 'Boundary Blueprint + Re-Entry Workbook', 'Instagram + Facebook', 'Teaser', $$If saying no makes you feel guilty before you've even said it, this one's for you.$$),
(12, 'Boundary Blueprint + Re-Entry Workbook', 'Instagram + Facebook', 'Value', $$Reframe boundaries as information, not rejection.$$),
(12, 'Boundary Blueprint + Re-Entry Workbook', 'Instagram + Facebook', 'Link-out', $$Blog link to both Boundary Blueprint and the Re-Entry Workbook.$$),
(12, 'Boundary Blueprint + Re-Entry Workbook', 'Pinterest', 'Pins', $$Boundary Blueprint: Pin title 'Why Saying No Feels Like Betrayal (And How to Fix It)', description 'A practical workbook for setting boundaries without the guilt.'
Re-Entry Workbook: Pin title 'Who Am I Now, After the Break?', description 'For anyone returning to work or life after a pause: career break, illness, caregiving, or burnout.'$$),

-- Week 13: bundle spotlight (added on top of the original roadmap so higher-ticket bundles get their own post; review before posting)
(13, 'Inner Work Trilogy', 'Instagram + Facebook', 'Bundle post', $$DRAFT, review before posting: If Fear Audit, Confidence Code, and Money Mindset each landed on their own, the Inner Work Trilogy has all three together, for less than buying them separately.$$),
(13, 'Unapologetic Series', 'Instagram + Facebook', 'Bundle post', $$DRAFT, review before posting: Strength Finder, Boundary Blueprint, and Re-Entry Workbook, together as one series for anyone rebuilding after suppression, loss, or a long pause.$$),
(13, 'Still Me Series', 'Instagram + Facebook', 'Bundle post', $$DRAFT, review before posting: Still Me, The Mother Behind the Role, and The Perimenopause Pivot: three workbooks for the different seasons of losing yourself, and finding your way back.$$),
(13, 'Complete Compass Collection', 'Instagram + Facebook', 'Bundle post', $$DRAFT, review before posting: Every workbook in one collection. For anyone who wants the whole toolkit, not just one piece of it.$$),
(13, 'Bundle Pins', 'Pinterest', 'Pins', $$DRAFT, review before posting: Create one pin per bundle using the finished cover art, title format 'The [Bundle Name]: [one-line benefit]', linking to that bundle's checkout page.$$);
