-- Pinterest pin schedule -> adds dated pins to the admin Content Calendar.
-- Run once in the Supabase SQL editor. They appear under "Week 20/21" with a
-- PINTEREST tag, a due date, and a Posted checkbox. Same-link pins are spaced
-- at least 3 days apart. Adjust dates in the admin date pickers any time.

insert into content_posts (week_number, product, platform, post_type, caption, due_date, posted, posted_at) values

-- WEEK 20 : this week
(20, 'Compass Check-In', 'Pinterest', 'Hook pin',
 $$Image: 01-checkin-hook.png | Board: Journal Prompts & Self-Reflection | Link: https://www.findyourcompasswithin.com/blog/compass-check-in$$,
 '2026-07-21', true, now()),
(20, 'Perimenopause Pivot', 'Pinterest', 'Hook pin',
 $$Image: 03-perimenopause.png | Board: Perimenopause & Midlife | Link: https://www.findyourcompasswithin.com/blog/what-if-it-has-a-biological-name$$,
 '2026-07-22', false, null),
(20, 'Compass Workbook', 'Pinterest', 'Hook pin',
 $$Image: 04-compass-workbook.png | Board: Career Clarity & Direction | Link: https://www.findyourcompasswithin.com/blog/what-would-your-life-look-like$$,
 '2026-07-23', false, null),
(20, 'Compass Check-In', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-compass-checkin.png | Board: Journal Prompts & Self-Reflection | Link: https://www.findyourcompasswithin.com/blog/compass-check-in$$,
 '2026-07-24', false, null),
(20, 'Boundary Blueprint', 'Pinterest', 'Hook pin',
 $$Image: 05-boundaries.png | Board: Boundaries & Saying No | Link: https://www.findyourcompasswithin.com/blog/where-are-you-saying-yes-and-meaning-no$$,
 '2026-07-25', false, null),
(20, 'Money Mindset', 'Pinterest', 'Hook pin',
 $$Image: 06-money.png | Board: Money Mindset | Link: https://www.findyourcompasswithin.com/blog/whose-voice-is-in-your-head-when-you-spend-money$$,
 '2026-07-26', false, null),

-- WEEK 21 : next week
(21, 'Compass Check-In', 'Pinterest', 'Video pin',
 $$Video: compass-checkin.mp4 | Board: Life Coaching Tips | Link: https://www.findyourcompasswithin.com/blog/compass-check-in$$,
 '2026-07-28', false, null),
(21, 'Perimenopause Pivot', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-perimenopause-pivot.png | Board: Perimenopause & Midlife | Link: https://www.findyourcompasswithin.com/blog/what-if-it-has-a-biological-name$$,
 '2026-07-29', false, null),
(21, 'Compass Workbook', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-compass-workbook.png | Board: Career Clarity & Direction | Link: https://www.findyourcompasswithin.com/blog/what-would-your-life-look-like$$,
 '2026-07-30', false, null),
(21, 'Boundary Blueprint', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-boundary-blueprint.png | Board: Boundaries & Saying No | Link: https://www.findyourcompasswithin.com/blog/where-are-you-saying-yes-and-meaning-no$$,
 '2026-07-31', false, null),
(21, 'Money Mindset', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-money-mindset.png | Board: Money Mindset | Link: https://www.findyourcompasswithin.com/blog/whose-voice-is-in-your-head-when-you-spend-money$$,
 '2026-08-01', false, null),
(21, 'Still Me', 'Pinterest', 'What''s inside',
 $$Image: whats-inside-still-me.png | Board: Motherhood & Identity | Link: https://www.findyourcompasswithin.com/blog/when-did-you-last-do-something-entirely-yours$$,
 '2026-08-02', false, null);
