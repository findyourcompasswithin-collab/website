/**
 * PRODUCT CATALOGUE
 * ─────────────────
 * Maps each product ID to its name, price, and which PDF files
 * in Supabase storage bucket "workbooks" are included.
 *
 * File names here must match exactly what you upload to Supabase.
 * Prices are in USD to match the website. Payfast will convert for
 * South African card holders automatically.
 */

export const PRODUCTS = {

  // ── DISCOVERY BUNDLE (Option 1 + 2) ────────────────────────────────────────
  'workbook': {
    name: 'Find Your True North Workbook',
    displayName: 'The Workbook',
    price: 27.00,
    files: ['find-your-true-north.pdf'],
  },
  'discovery-bundle': {
    name: 'Chart Your Course — Discovery Bundle',
    displayName: 'Chart Your Course Bundle',
    price: 57.00,
    files: [
      'find-your-true-north.pdf',
      'habit-tracker.pdf',
      'gratitude-journal.pdf',
      'letters-to-future-self.pdf',
    ],
  },

  // ── INNER WORK TRILOGY ──────────────────────────────────────────────────────
  'fear-audit': {
    name: 'The Fear Audit — Deep-Dive Workbook',
    displayName: 'The Fear Audit',
    price: 37.00,
    files: ['fear-audit.pdf'],
  },
  'confidence-code': {
    name: 'The Confidence Code — Deep-Dive Workbook',
    displayName: 'The Confidence Code',
    price: 37.00,
    files: ['confidence-code.pdf'],
  },
  'money-mindset': {
    name: 'Money Mindset Workbook — Deep-Dive',
    displayName: 'Money Mindset Workbook',
    price: 37.00,
    files: ['money-mindset.pdf'],
  },
  'inner-work-trilogy': {
    name: 'The Inner Work Trilogy Bundle',
    displayName: 'The Inner Work Trilogy',
    price: 97.00,
    files: [
      'fear-audit.pdf',
      'confidence-code.pdf',
      'money-mindset.pdf',
    ],
  },

  // ── THE UNAPOLOGETIC SERIES ─────────────────────────────────────────────────
  'strength-finder': {
    name: 'The Strength Finder — Specialist Workbook',
    displayName: 'The Strength Finder',
    price: 47.00,
    files: ['strength-finder.pdf'],
  },
  'boundary-blueprint': {
    name: 'The Boundary Blueprint — Specialist Workbook',
    displayName: 'The Boundary Blueprint',
    price: 47.00,
    files: ['boundary-blueprint.pdf'],
  },
  're-entry': {
    name: 'The Re-Entry Workbook — Specialist',
    displayName: 'The Re-Entry Workbook',
    price: 47.00,
    files: ['re-entry.pdf'],
  },
  'unapologetic-series': {
    name: 'The Unapologetic Series Bundle',
    displayName: 'The Unapologetic Series',
    price: 117.00,
    files: [
      'strength-finder.pdf',
      'boundary-blueprint.pdf',
      're-entry.pdf',
    ],
  },

  // ── COMPLETE COMPASS COLLECTION ─────────────────────────────────────────────
  'complete-collection': {
    name: 'The Complete Compass Collection',
    displayName: 'The Complete Compass Collection',
    price: 197.00,
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
    ],
  },
};
