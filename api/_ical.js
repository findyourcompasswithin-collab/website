/**
 * iCalendar generator for booking confirmation emails.
 * Times in the database are stored as SAST (Africa/Johannesburg, UTC+2,
 * no DST), so we subtract 2 hours to produce the UTC stamps that .ics
 * requires.
 *
 * Output is wrapped in CRLF per RFC 5545.
 */

const PRODID = '-//Find Your Compass Within//Booking//EN';

function pad(n) { return String(n).padStart(2, '0'); }

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function sastToUtc(dateStr, timeStr) {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:MM' or 'HH:MM:SS', both in SAST.
  const [y, mo, d] = dateStr.split('-').map(Number);
  const parts      = timeStr.split(':').map(Number);
  const [h, mi, s = 0] = parts;
  // SAST = UTC+2, no DST. Subtract 2h to get UTC.
  return new Date(Date.UTC(y, mo - 1, d, h - 2, mi, s));
}

function escapeIcs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildEvent({ uid, startUtc, endUtc, summary, description, location, organizerName, organizerEmail, attendeeName, attendeeEmail }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(startUtc)}`,
    `DTEND:${utcStamp(endUtc)}`,
    `SUMMARY:${escapeIcs(summary)}`,
  ];
  if (description)     lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  if (location) {
    lines.push(`LOCATION:${escapeIcs(location)}`);
    lines.push(`URL:${escapeIcs(location)}`);
  }
  if (organizerEmail)  lines.push(`ORGANIZER;CN=${escapeIcs(organizerName || organizerEmail)}:mailto:${organizerEmail}`);
  if (attendeeEmail)   lines.push(`ATTENDEE;CN=${escapeIcs(attendeeName || attendeeEmail)};RSVP=FALSE:mailto:${attendeeEmail}`);
  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function wrapCalendar(events) {
  const arr = Array.isArray(events) ? events : [events];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...arr.map(buildEvent),
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Build a Resend-compatible attachment for a single 1:1 session.
 * Returns { filename, content } where content is base64-encoded.
 */
export function makeSessionInvite({
  bookingId,
  date,              // 'YYYY-MM-DD' SAST
  time,              // 'HH:MM' or 'HH:MM:SS' SAST
  durationMinutes = 60,
  summary,
  description,
  meetLink,
  clientName,
  clientEmail,
  ownerEmail,
  ownerName = 'Mel Cooper',
  filename  = 'session.ics',
}) {
  const startUtc = sastToUtc(date, time);
  const endUtc   = new Date(startUtc.getTime() + durationMinutes * 60_000);
  const ics = wrapCalendar({
    uid: `${bookingId}-${date}-${time.replace(/:/g, '')}@findyourcompasswithin.com`,
    startUtc,
    endUtc,
    summary,
    description,
    location: meetLink,
    organizerName: ownerName,
    organizerEmail: ownerEmail,
    attendeeName: clientName,
    attendeeEmail: clientEmail,
  });
  return {
    filename,
    content: Buffer.from(ics).toString('base64'),
  };
}
