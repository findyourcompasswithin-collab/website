/**
 * SHARED SCHEDULE CONSTANTS
 * ─────────────────────────
 * One source of truth for the bookable time slots, imported by both
 * get-available-slots.js (what the calendar offers) and create-booking.js
 * (what a booking is allowed to use). Keeping them in one place stops the
 * two ever drifting apart.
 *
 * Schedule: Monday to Friday.
 *   Mornings  09:00-12:00 SAST  → daytime for UK and Europe
 *   Evenings  21:00-22:00 SAST  → after the workday for SA, UK and Europe,
 *                                  and after Mel's family time
 * Times outside these (including 15:00-20:30 family time) are never offered.
 */

export const SAST_OFFSET_HOURS = 2; // UTC+2, no daylight saving in South Africa
export const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '21:00', '22:00'];
