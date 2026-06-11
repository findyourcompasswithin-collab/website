/**
 * PRODUCT CATALOGUE
 * ─────────────────
 * Maps each product ID to its name, price, type, and files.
 *
 * type: 'digital'  → PDF download, delivered via Supabase signed URL
 * type: 'coaching' → Session package, triggers booking + questionnaire flow
 *
 * File names must match exactly what you upload to Supabase bucket "workbooks".
 * Prices are in USD. Payfast converts for SA cardholders automatically.
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
    price: 47.00,
    type: 'digital',
    files: ['strength-finder.pdf'],
  },
  'boundary-blueprint': {
    name: 'The Boundary Blueprint: Specialist Workbook',
    displayName: 'The Boundary Blueprint',
    price: 47.00,
    type: 'digital',
    files: ['boundary-blueprint.pdf'],
  },
  're-entry': {
    name: 'The Re-Entry Workbook: Specialist',
    displayName: 'The Re-Entry Workbook',
    price: 47.00,
    type: 'digital',
    files: ['re-entry.pdf'],
  },
  'unapologetic-series': {
    name: 'The Unapologetic Series Bundle',
    displayName: 'The Unapologetic Series',
    price: 117.00,
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
    price: 35.00,
    type: 'digital',
    files: ['mother-behind-the-role.pdf'],
  },
  'perimenopause-pivot': {
    name: 'The Perimenopause Pivot: Navigating the Shift Nobody Warned You About',
    displayName: 'The Perimenopause Pivot',
    price: 35.00,
    type: 'digital',
    files: ['perimenopause-pivot.pdf'],
  },
  'still-me-series': {
    name: 'The Still Me Series Bundle',
    displayName: 'The Still Me Series',
    price: 92.00,
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
    files: [],
  },
  'guided-navigation': {
    name: 'Guided Navigation: 5-Session Programme',
    displayName: 'Guided Navigation',
    price: 397.00,
    type: 'coaching',
    sessions: 5,
    files: [],
  },
};
