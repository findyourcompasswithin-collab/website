/**
 * PRODUCT CATALOGUE
 * ─────────────────
 * Maps each product ID to its name, price, type, and files.
 *
 * type: 'digital'  → PDF download, delivered via Supabase signed URL
 * type: 'coaching' → Session package, triggers booking + questionnaire flow
 *
 * File names must match exactly what you upload to Supabase bucket "workbooks".
 * Prices are in USD. api/fx.js converts them to ZAR at checkout, because
 * Payfast settles only in rand; foreign buyers can pay the equivalent in
 * their own currency via Payfast multi-currency.
 */

export const PRODUCTS = {

  // ── DISCOVERY BUNDLE ────────────────────────────────────────────────────────
  'workbook': {
    name: 'The Compass Workbook',
    displayName: 'The Compass Workbook',
    price: 27.00,
    type: 'digital',
    files: ['find-your-true-north.pdf'],
  },
  'chart-your-course': {
    name: 'Chart Your Course',
    displayName: 'Chart Your Course',
    price: 27.00,
    type: 'digital',
    files: [
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },
  'discovery-bundle': {
    name: 'The Discovery Bundle',
    displayName: 'The Discovery Bundle',
    price: 44.00,
    type: 'digital',
    files: [
      'find-your-true-north.pdf',
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },
  'discovery-bundle-upgrade': {
    name: 'Chart Your Course: Companion Tools Upgrade',
    displayName: 'Chart Your Course Companion Tools',
    price: 27.00,
    type: 'digital',
    files: [
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },

  // ── INNER WORK TRILOGY ──────────────────────────────────────────────────────
  'fear-audit': {
    name: 'The Fear Audit: Deep-Dive Workbook',
    displayName: 'The Fear Audit',
    price: 35.00,
    type: 'digital',
    files: ['fear-audit.pdf'],
  },
  'confidence-code': {
    name: 'The Confidence Code: Deep-Dive Workbook',
    displayName: 'The Confidence Code',
    price: 35.00,
    type: 'digital',
    files: ['confidence-code.pdf'],
  },
  'money-mindset': {
    name: 'Money Mindset Workbook: Deep-Dive',
    displayName: 'Money Mindset Workbook',
    price: 35.00,
    type: 'digital',
    files: ['money-mindset.pdf'],
  },
  'inner-work-trilogy': {
    name: 'The Inner Work Trilogy Bundle',
    displayName: 'The Inner Work Trilogy',
    price: 92.00,
    type: 'digital',
    files: [
      'fear-audit.pdf',
      'confidence-code.pdf',
      'money-mindset.pdf',
    ],
  },

  // ── THE UNAPOLOGETIC SERIES ─────────────────────────────────────────────────
  'strength-finder': {
    name: 'The Strength Finder: Specialist Workbook',
    displayName: 'The Strength Finder',
    price: 35.00,
    type: 'digital',
    files: ['strength-finder.pdf'],
  },
  'boundary-blueprint': {
    name: 'The Boundary Blueprint: Specialist Workbook',
    displayName: 'The Boundary Blueprint',
    price: 35.00,
    type: 'digital',
    files: ['boundary-blueprint.pdf'],
  },
  're-entry': {
    name: 'The Re-Entry Workbook: Specialist',
    displayName: 'The Re-Entry Workbook',
    price: 35.00,
    type: 'digital',
    files: ['re-entry.pdf'],
  },
  'unapologetic-series': {
    name: 'The Unapologetic Series Bundle',
    displayName: 'The Unapologetic Series',
    price: 92.00,
    type: 'digital',
    files: [
      'strength-finder.pdf',
      'boundary-blueprint.pdf',
      're-entry.pdf',
    ],
  },

  // ── STILL ME SERIES ─────────────────────────────────────────────────────────
  'still-me': {
    name: 'Still Me: Finding Your Compass as a Parent',
    displayName: 'Still Me',
    price: 35.00,
    type: 'digital',
    files: ['still-me.pdf'],
  },
  'mother-behind-the-role': {
    name: 'The Mother Behind the Role: Understanding Your Child From the Womb to the World',
    displayName: 'The Mother Behind the Role',
    price: 44.00,
    type: 'digital',
    files: ['mother-behind-the-role.pdf'],
  },
  'perimenopause-pivot': {
    name: 'The Perimenopause Pivot: Navigating the Shift Nobody Warned You About',
    displayName: 'The Perimenopause Pivot',
    price: 44.00,
    type: 'digital',
    files: ['perimenopause-pivot.pdf'],
  },
  'still-me-series': {
    name: 'The Still Me Series Bundle',
    displayName: 'The Still Me Series',
    price: 107.00,
    type: 'digital',
    files: [
      'still-me.pdf',
      'mother-behind-the-role.pdf',
      'perimenopause-pivot.pdf',
    ],
  },

  // ── COMPLETE COMPASS COLLECTION ─────────────────────────────────────────────
  'complete-collection': {
    name: 'The Complete Compass Collection',
    displayName: 'The Complete Compass Collection',
    price: 233.00,
    type: 'digital',
    files: [
      'find-your-true-north.pdf',
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
      'fear-audit.pdf',
      'confidence-code.pdf',
      'money-mindset.pdf',
      'strength-finder.pdf',
      'boundary-blueprint.pdf',
      're-entry.pdf',
      'still-me.pdf',
      'mother-behind-the-role.pdf',
      'perimenopause-pivot.pdf',
    ],
  },

  // ── COACHING SESSIONS ───────────────────────────────────────────────────────
  'compass-reading': {
    name: 'A Compass Reading: Single Session',
    displayName: 'A Compass Reading',
    price: 77.00,
    type: 'coaching',
    sessions: 1,
    files: [],
  },
  'expedition': {
    name: 'The Expedition: 3-Session Programme',
    displayName: 'The Expedition',
    price: 297.00,
    type: 'coaching',
    sessions: 3,
    // Sales card promises "Full Discovery Bundle (all 4 PDF tools)" — delivered as
    // a second email at purchase time, alongside the booking welcome.
    files: [
      'find-your-true-north.pdf',
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },
  'guided-navigation': {
    name: 'Guided Navigation: 5-Session Programme',
    displayName: 'Guided Navigation',
    price: 397.00,
    type: 'coaching',
    sessions: 5,
    files: [
      'find-your-true-north.pdf',
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },

  // ── GROUP ROUNDS (COMPASS CIRCLES) ──────────────────────────────────────────
  // A Circle is a small, time-bound group round built on an existing workbook.
  // It is a 'coaching' product so it still creates a booking and sends the intake
  // questionnaire, but format:'group' means it skips the 1:1 self-serve calendar:
  // the dates are fixed for the whole cohort (see cohort.dates below).
  'compass-circle-perimenopause': {
    name: 'The Perimenopause Pivot: A Guided Round (Founding Circle)',
    displayName: 'The Perimenopause Pivot Guided Round',
    price: 117.00,
    type: 'coaching',
    format: 'group',
    intake: 'perimenopause', // tells the questionnaire to render the perimenopause-specific step 2
    sessions: 6,            // six weekly live calls
    seats: null,            // soft cap, not shown to clients; Mel keeps it a small group (her call, e.g. up to ~10)
    cohort: {
      name: 'Founding Circle',
      // Structured per-week schedule. Each entry: { week, date, time } in SAST.
      // Mel can replace the placeholders below with real dates when ready.
      // While `confirmed: false` is set, the welcome email and confirmation
      // page still say "I'll email you the dates shortly" — Phase C reminders
      // also stay dormant until Mel flips confirmed: true.
      confirmed: false,
      dates: [
        // PLACEHOLDERS — replace dates + flip confirmed:true before opening enrolment.
        { week: 1, date: '2026-09-02', time: '19:00' },
        { week: 2, date: '2026-09-09', time: '19:00' },
        { week: 3, date: '2026-09-16', time: '19:00' },
        { week: 4, date: '2026-09-23', time: '19:00' },
        { week: 5, date: '2026-09-30', time: '19:00' },
        { week: 6, date: '2026-10-07', time: '19:00' },
      ],
    },
    // Round includes the workbook so members get it as a second email at purchase.
    files: ['perimenopause-pivot.pdf'],
  },
};
