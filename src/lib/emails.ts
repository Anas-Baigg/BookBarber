import { Resend } from 'resend';
import { formatDateTimeInZone } from './utils';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'BookBarber <onboarding@resend.dev>';

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(fn: string, to: string, id?: string) {
  console.log(`[email] ${fn} → ${to}${id ? ` (id=${id})` : ''}`);
}

async function send(fn: string, to: string, subject: string, html: string): Promise<void> {
  if (!to) {
    console.warn(`[email] ${fn} skipped — no recipient address`);
    return;
  }
  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    console.error(`[email] ${fn} FAILED → ${to}`, {
      name:       error.name,
      message:    error.message,
      statusCode: (error as unknown as { statusCode?: number }).statusCode,
    });
    throw new Error(`Email send failed (${fn}): ${error.message}`);
  }
  log(fn, to, data?.id);
}

// ── Shared layout helpers ─────────────────────────────────────────────────────

function emailLayout(shopName: string, shopAddress: string | null | undefined, content: string): string {
  const addrLine = shopAddress
    ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;text-align:center;">${shopAddress}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Inter,Arial,sans-serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2e2e2e;max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#C9A84C,#E8C86B);padding:28px 36px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#0f0f0f;letter-spacing:-0.3px;">&#9986; BookBarber</p>
            <p style="margin:6px 0 0;font-size:13px;color:#4a3a1a;font-weight:500;">${shopName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px;border-top:1px solid #2e2e2e;background:#141414;">
            <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;font-weight:500;">${shopName}</p>
            ${addrLine}
            <p style="margin:10px 0 0;font-size:11px;color:#4b5563;text-align:center;">&#169; ${new Date().getFullYear()} BookBarber. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bookingCard(opts: {
  shopName:     string;
  shopAddress?: string | null;
  barberName:   string;
  datetime:     string;
}): string {
  const addrLine = opts.shopAddress
    ? `<p style="margin:3px 0 0;font-size:12px;color:#9ca3af;">${opts.shopAddress}</p>`
    : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#242424;border-radius:8px;border:1px solid #333333;margin:20px 0 24px;">
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:14px 20px;border-bottom:1px solid #333333;">
        <span style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;display:block;margin-bottom:5px;">Shop</span>
        <span style="font-size:15px;color:#ffffff;font-weight:500;">${opts.shopName}</span>
        ${addrLine}
      </td></tr>
      <tr><td style="padding:14px 20px;border-bottom:1px solid #333333;">
        <span style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;display:block;margin-bottom:5px;">Barber</span>
        <span style="font-size:15px;color:#ffffff;font-weight:500;">${opts.barberName}</span>
      </td></tr>
      <tr><td style="padding:14px 20px;border-bottom:1px solid #333333;">
        <span style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;display:block;margin-bottom:5px;">Date &amp; Time</span>
        <span style="font-size:16px;color:#C9A84C;font-weight:700;">${opts.datetime}</span>
      </td></tr>
      <tr><td style="padding:14px 20px;">
        <span style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;display:block;margin-bottom:5px;">Duration</span>
        <span style="font-size:15px;color:#ffffff;font-weight:500;">25 minutes</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function ctaButton(url: string, text: string): string {
  return `<a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#C9A84C,#E8C86B);color:#0f0f0f;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.1px;">${text}</a>`;
}

// ── BookingEmailData interface ────────────────────────────────────────────────

interface BookingEmailData {
  customerName:  string;
  customerEmail: string;
  shopName:      string;
  shopAddress?:  string | null;
  shopSlug?:     string;
  barberName:    string;
  startTime:     string;
  timezone:      string;
  bookingId:     string;
  notes?:        string | null;
  appUrl:        string;
}

// ── Template 1 — Booking confirmation ────────────────────────────────────────

export async function sendBookingConfirmation(data: BookingEmailData) {
  const datetime = formatDateTimeInZone(data.startTime, data.timezone);
  const card     = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: data.barberName, datetime,
  });

  const notesSection = data.notes
    ? `<div style="background:#1e1e1e;border:1px solid #2e2e2e;border-radius:6px;padding:14px 16px;margin:0 0 24px;">
        <p style="margin:0 0 4px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Your Notes</p>
        <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">${data.notes}</p>
       </div>`
    : '';

  const policySection = `<div style="background:#111f11;border:1px solid #1a3a1a;border-radius:6px;padding:14px 16px;margin:0 0 28px;">
    <p style="margin:0;font-size:13px;color:#86efac;line-height:1.6;"><strong style="color:#4ade80;">Need to make a change?</strong> You can reschedule or cancel your appointment at any time from your booking page. We appreciate as much notice as possible.</p>
  </div>`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Your appointment is confirmed!</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, your appointment has been booked. Here are your details.</p>
    ${card}
    ${notesSection}
    ${policySection}
    ${ctaButton(`${data.appUrl}/booking/${data.bookingId}`, 'View My Booking')}`;

  await send(
    'sendBookingConfirmation',
    data.customerEmail,
    `Your appointment is confirmed — ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 2 — Booking cancellation ────────────────────────────────────────

export async function sendBookingCancellation(data: BookingEmailData & { cancelledBy: string }) {
  const datetime     = formatDateTimeInZone(data.startTime, data.timezone);
  const card         = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: data.barberName, datetime,
  });
  const byCustomer   = data.cancelledBy === 'customer';
  const rebookHref   = data.shopSlug
    ? `${data.appUrl}/shop/${data.shopSlug}`
    : `${data.appUrl}/shops`;

  const heading = byCustomer
    ? 'Your appointment has been cancelled.'
    : 'Your appointment has been cancelled by the shop.';
  const intro = byCustomer
    ? `Hi ${data.customerName}, your cancellation has been confirmed.`
    : `Hi ${data.customerName}, we are sorry to let you know that your upcoming appointment has been cancelled by the shop.`;
  const closing = byCustomer
    ? `<p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">We hope to see you soon.</p>`
    : `<p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">We apologise for any inconvenience. Please book a new appointment at your convenience.</p>`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">${heading}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">${intro}</p>
    ${card}
    ${closing}
    ${ctaButton(rebookHref, byCustomer ? 'Book Again' : 'Book a New Appointment')}`;

  await send(
    'sendBookingCancellation',
    data.customerEmail,
    `Your appointment has been cancelled — ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 3 — Booking rescheduled ─────────────────────────────────────────

export async function sendBookingRescheduled(
  data: BookingEmailData & { newStartTime: string; newBarberName?: string }
) {
  const oldDatetime      = formatDateTimeInZone(data.startTime,    data.timezone);
  const newDatetime      = formatDateTimeInZone(data.newStartTime, data.timezone);
  const effectiveBarber  = data.newBarberName ?? data.barberName;
  const barberChanged    = !!data.newBarberName && data.newBarberName !== data.barberName;

  const previousCard = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1e1e;border-radius:8px;border:1px solid #2e2e2e;margin:20px 0 8px;">
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:12px 20px;border-bottom:1px solid #2e2e2e;">
        <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Previous Appointment</span>
      </td></tr>
      <tr><td style="padding:10px 20px;border-bottom:1px solid #2e2e2e;">
        <span style="font-size:10px;color:#6b7280;display:block;margin-bottom:3px;">Barber</span>
        <span style="font-size:14px;color:#6b7280;">${data.barberName}</span>
      </td></tr>
      <tr><td style="padding:10px 20px;">
        <span style="font-size:10px;color:#6b7280;display:block;margin-bottom:3px;">Date &amp; Time</span>
        <span style="font-size:14px;color:#6b7280;text-decoration:line-through;">${oldDatetime}</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const newCard = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: effectiveBarber, datetime: newDatetime,
  });

  const barberNote = barberChanged
    ? `<div style="background:#1a1700;border:1px solid #3a3000;border-radius:6px;padding:12px 16px;margin:0 0 24px;">
        <p style="margin:0;font-size:13px;color:#fbbf24;line-height:1.5;">Your barber for this appointment is now <strong>${effectiveBarber}</strong>.</p>
       </div>`
    : '';

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Your appointment has been rescheduled.</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, your appointment has been moved. Here are your updated details.</p>
    ${previousCard}
    <p style="margin:8px 0;font-size:12px;color:#6b7280;text-align:center;">&#8595; New appointment</p>
    ${newCard}
    ${barberNote}
    ${ctaButton(`${data.appUrl}/booking/${data.bookingId}`, 'View My Booking')}`;

  await send(
    'sendBookingRescheduled',
    data.customerEmail,
    `Your appointment has been rescheduled — ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 4 — Reschedule offer ────────────────────────────────────────────

export async function sendRescheduleOffer(data: BookingEmailData & { rescheduleDeadline?: string }) {
  const datetime    = formatDateTimeInZone(data.startTime, data.timezone);
  const expiryText  = data.rescheduleDeadline
    ? `by <strong>${formatDateTimeInZone(data.rescheduleDeadline, data.timezone)}</strong>`
    : 'within 24 hours';

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Action required &#8212; please reschedule.</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, we are sorry for the inconvenience. Your barber <strong style="color:#ffffff;">${data.barberName}</strong> is unavailable for your appointment on <strong style="color:#ffffff;">${datetime}</strong>.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Please choose a new time using the button below. You can also choose a different barber.</p>
    <div style="background:#1a1700;border:1px solid #3a3000;border-radius:6px;padding:14px 16px;margin:0 0 28px;">
      <p style="margin:0;font-size:13px;color:#fbbf24;line-height:1.6;"><strong>&#9203; This link expires in 24 hours.</strong> If you do not reschedule ${expiryText}, your appointment will be automatically cancelled.</p>
    </div>
    ${ctaButton(`${data.appUrl}/booking/${data.bookingId}`, 'Choose a New Time')}
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">If you would prefer to cancel instead, you can also do that from the same page.</p>`;

  await send(
    'sendRescheduleOffer',
    data.customerEmail,
    `Action required — please reschedule your appointment at ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 5 — Emergency cancellation ──────────────────────────────────────

export async function sendEmergencyCancellation(data: BookingEmailData & { shopSlug: string }) {
  const datetime = formatDateTimeInZone(data.startTime, data.timezone);
  const card     = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: data.barberName, datetime,
  });
  const rebookHref = data.shopSlug
    ? `${data.appUrl}/shop/${data.shopSlug}`
    : `${data.appUrl}/shops`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">We are sorry &#8212; your appointment has been cancelled.</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, we are sorry for the short notice. Your appointment has been cancelled.</p>
    ${card}
    <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">We apologise for any inconvenience this may cause. Please feel free to book a new appointment at your convenience.</p>
    ${ctaButton(rebookHref, 'Book a New Appointment')}`;

  await send(
    'sendEmergencyCancellation',
    data.customerEmail,
    `Your appointment has been cancelled — ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 6 — Barber reassigned ───────────────────────────────────────────

export async function sendBarberReassigned(data: BookingEmailData & { newBarberName: string }) {
  const datetime = formatDateTimeInZone(data.startTime, data.timezone);
  // Card shows the new barber — customer sees who they will actually see
  const card = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: data.newBarberName, datetime,
  });

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">A small update to your appointment.</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, we have made a small change to your upcoming appointment.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Your original barber <strong style="color:#ffffff;">${data.barberName}</strong> is unavailable. Your appointment has been reassigned to <strong style="color:#C9A84C;">${data.newBarberName}</strong>.</p>
    ${card}
    <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">Everything else about your appointment &#8212; date, time, and location &#8212; remains the same. We apologise for any inconvenience.</p>
    ${ctaButton(`${data.appUrl}/booking/${data.bookingId}`, 'View My Booking')}`;

  await send(
    'sendBarberReassigned',
    data.customerEmail,
    `Update to your appointment — ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Template 7 — Appointment reminder (new) ──────────────────────────────────

export async function sendAppointmentReminder(data: BookingEmailData) {
  const datetime = formatDateTimeInZone(data.startTime, data.timezone);
  const card     = bookingCard({
    shopName: data.shopName, shopAddress: data.shopAddress,
    barberName: data.barberName, datetime,
  });

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Your appointment is tomorrow.</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi ${data.customerName}, just a friendly reminder that you have an appointment tomorrow.</p>
    ${card}
    ${ctaButton(`${data.appUrl}/booking/${data.bookingId}`, 'View My Booking')}
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Need to make a change? You can reschedule or cancel your appointment from your booking page.</p>`;

  await send(
    'sendAppointmentReminder',
    data.customerEmail,
    `Reminder — your appointment is tomorrow at ${data.shopName}`,
    emailLayout(data.shopName, data.shopAddress, content)
  );
}

// ── Admin notification emails (unchanged) ────────────────────────────────────

export async function sendAdminCancellationNotice(opts: {
  adminEmail:   string;
  shopName:     string;
  customerName: string;
  barberName:   string;
  startTime:    string;
  timezone:     string;
  bookingId:    string;
  appUrl:       string;
}) {
  const datetime = formatDateTimeInZone(opts.startTime, opts.timezone);
  await send(
    'sendAdminCancellationNotice',
    opts.adminEmail,
    `[BookBarber] Booking Cancelled by Customer — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Booking Cancelled</h2>
      <p>A customer has cancelled their booking.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName}</li>
        <li><strong>Barber:</strong> ${opts.barberName}</li>
        <li><strong>Was scheduled:</strong> ${datetime}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/admin/bookings" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View in Admin
      </a>
    </body></html>`
  );
}

export async function sendAdminRescheduledNotice(opts: {
  adminEmail:   string;
  shopName:     string;
  customerName: string;
  barberName:   string;
  oldStartTime: string;
  newStartTime: string;
  timezone:     string;
  bookingId:    string;
  appUrl:       string;
}) {
  const oldDt = formatDateTimeInZone(opts.oldStartTime, opts.timezone);
  const newDt = formatDateTimeInZone(opts.newStartTime, opts.timezone);
  await send(
    'sendAdminRescheduledNotice',
    opts.adminEmail,
    `[BookBarber] Booking Rescheduled by Customer — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Booking Rescheduled</h2>
      <p>A customer has rescheduled their booking.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName}</li>
        <li><strong>Barber:</strong> ${opts.barberName}</li>
        <li><strong>Was:</strong> ${oldDt}</li>
        <li><strong>Now:</strong> ${newDt}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/admin/bookings" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View in Admin
      </a>
    </body></html>`
  );
}

export async function sendUnavailabilitySummary(opts: {
  adminEmail:   string;
  employeeName: string;
  shopName:     string;
  date:         string;
  timezone:     string;
  rows: Array<{
    customerName:  string;
    customerEmail: string;
    startTime:     string;
    action:        string;
    newBarberName?: string;
  }>;
  appUrl: string;
}) {
  const rows = opts.rows
    .map((r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #2e2e2e;color:#d1d5db;">${r.customerName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2e2e2e;color:#9ca3af;font-size:12px;">${r.customerEmail}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2e2e2e;color:#C9A84C;">${r.startTime}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #2e2e2e;color:#ffffff;">${r.action}${r.newBarberName ? ` → ${r.newBarberName}` : ''}</td>
      </tr>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unavailability Summary</title></head>
<body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
  <h2 style="color:#C9A84C;">Unavailability Summary — ${opts.shopName}</h2>
  <p><strong>${opts.employeeName}</strong> marked unavailable on <strong>${opts.date}</strong></p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:8px;border:1px solid #2e2e2e;margin-top:16px;">
    <thead>
      <tr style="background:#242424;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9ca3af;">Customer</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9ca3af;">Email</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9ca3af;">Time</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9ca3af;">Action</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:24px;">
    <a href="${opts.appUrl}/admin/bookings" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">View Bookings</a>
  </div>
</body>
</html>`;
  await send(
    'sendUnavailabilitySummary',
    opts.adminEmail,
    `[BookBarber] Unavailability Summary — ${opts.employeeName} on ${opts.date}`,
    html
  );
}

// ── Employee notification emails (unchanged) ─────────────────────────────────

export async function sendBookingAssigned(opts: {
  employeeEmail: string;
  employeeName:  string;
  customerName:  string;
  shopName:      string;
  startTime:     string;
  timezone:      string;
  bookingId:     string;
  appUrl:        string;
}) {
  const datetime = formatDateTimeInZone(opts.startTime, opts.timezone);
  await send(
    'sendBookingAssigned',
    opts.employeeEmail,
    `Booking Assigned to You — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Booking Assigned to You</h2>
      <p>Hi ${opts.employeeName}, a booking has been reassigned to you.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName}</li>
        <li><strong>When:</strong> ${datetime}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendEmployeeBookingCancelled(opts: {
  employeeEmail: string;
  employeeName:  string;
  customerName:  string;
  startTime:     string;
  timezone:      string;
  shopName:      string;
  reason:        string;
  appUrl:        string;
}) {
  const datetime = formatDateTimeInZone(opts.startTime, opts.timezone);
  await send(
    'sendEmployeeBookingCancelled',
    opts.employeeEmail,
    `Booking Cancelled on Your Schedule — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Booking Cancelled</h2>
      <p>Hi ${opts.employeeName}, a booking on your schedule has been cancelled.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName}</li>
        <li><strong>Was scheduled:</strong> ${datetime}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
        <li><strong>Reason:</strong> ${opts.reason}</li>
      </ul>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendEmployeeScheduleChanged(opts: {
  employeeEmail: string;
  employeeName:  string;
  date:          string;
  type:          'day_off' | 'different_hours' | 'extra_day';
  startTime?:    string;
  endTime?:      string;
  notes?:        string | null;
  shopName:      string;
  appUrl:        string;
}) {
  const typeLabel =
    opts.type === 'day_off'         ? 'Day Off'         :
    opts.type === 'different_hours' ? `Different hours: ${opts.startTime?.slice(0, 5)} – ${opts.endTime?.slice(0, 5)}` :
                                      'Extra Working Day';
  await send(
    'sendEmployeeScheduleChanged',
    opts.employeeEmail,
    `Schedule Update for ${opts.date} — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Schedule Updated</h2>
      <p>Hi ${opts.employeeName}, your schedule has been updated.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Date:</strong> ${opts.date}</li>
        <li><strong>Change:</strong> ${typeLabel}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
        ${opts.notes ? `<li><strong>Note:</strong> ${opts.notes}</li>` : ''}
      </ul>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendTimeOffApproved(opts: {
  employeeEmail: string;
  employeeName:  string;
  date:          string;
  shopName:      string;
  appUrl:        string;
}) {
  await send(
    'sendTimeOffApproved',
    opts.employeeEmail,
    `Time Off Approved — ${opts.date}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Time Off Approved</h2>
      <p>Hi ${opts.employeeName}, your time off request has been approved.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Date:</strong> ${opts.date}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <p style="color:#9ca3af;font-size:14px;">No new bookings can be made for you on this date.</p>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendTimeOffDenied(opts: {
  employeeEmail: string;
  employeeName:  string;
  date:          string;
  adminNotes?:   string | null;
  shopName:      string;
  appUrl:        string;
}) {
  await send(
    'sendTimeOffDenied',
    opts.employeeEmail,
    `Time Off Request Not Approved — ${opts.date}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#ef4444;">Time Off Not Approved</h2>
      <p>Hi ${opts.employeeName}, your time off request for <strong>${opts.date}</strong> was not approved.</p>
      ${opts.adminNotes ? `<p style="color:#d1d5db;"><strong>Note from admin:</strong> ${opts.adminNotes}</p>` : ''}
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendTimeOffRequestReceived(opts: {
  adminEmail:   string;
  employeeName: string;
  date:         string;
  reason:       string;
  shopName:     string;
  appUrl:       string;
}) {
  await send(
    'sendTimeOffRequestReceived',
    opts.adminEmail,
    `[BookBarber] Time Off Request — ${opts.employeeName} on ${opts.date}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Time Off Request</h2>
      <p><strong>${opts.employeeName}</strong> has requested time off.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Date:</strong> ${opts.date}</li>
        <li><strong>Reason:</strong> ${opts.reason}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/admin/employees" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        Review Request
      </a>
    </body></html>`
  );
}

export async function sendEmployeeActivatedNotice(opts: {
  adminEmail:   string;
  employeeName: string;
  shopName:     string;
  appUrl:       string;
}) {
  await send(
    'sendEmployeeActivatedNotice',
    opts.adminEmail,
    `${opts.employeeName} has set up their account — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">New Employee Activated ✓</h2>
      <p>Good news — <strong>${opts.employeeName}</strong> has set up their account and can now log in to BookBarber.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/admin/employees" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View Employees
      </a>
    </body></html>`
  );
}

export async function sendEmployeeAccountRemoved(opts: {
  employeeEmail: string;
  employeeName:  string;
  shopName:      string;
  appUrl:        string;
}) {
  await send(
    'sendEmployeeAccountRemoved',
    opts.employeeEmail,
    `Your Account Has Been Removed — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Account Removed</h2>
      <p>Hi ${opts.employeeName}, your employee account has been removed from <strong>${opts.shopName}</strong>.</p>
      <p style="color:#9ca3af;font-size:14px;">If you have any questions, please contact the shop owner directly.</p>
    </body></html>`
  );
}

export async function sendEmployeeScheduleBaseChanged(opts: {
  employeeEmail: string;
  employeeName:  string;
  shopName:      string;
  appUrl:        string;
}) {
  await send(
    'sendEmployeeScheduleBaseChanged',
    opts.employeeEmail,
    `Your Weekly Schedule Has Been Updated — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Schedule Updated</h2>
      <p>Hi ${opts.employeeName}, your weekly schedule at <strong>${opts.shopName}</strong> has been updated.</p>
      <p style="color:#9ca3af;font-size:14px;">Please log in to view your new schedule.</p>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendEmployeeOverrideRemoved(opts: {
  employeeEmail: string;
  employeeName:  string;
  date:          string;
  shopName:      string;
  appUrl:        string;
}) {
  await send(
    'sendEmployeeOverrideRemoved',
    opts.employeeEmail,
    `Schedule Exception Removed for ${opts.date} — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Schedule Exception Removed</h2>
      <p>Hi ${opts.employeeName}, the schedule exception for <strong>${opts.date}</strong> at ${opts.shopName} has been removed.</p>
      <p style="color:#9ca3af;font-size:14px;">Your regular schedule applies on that day.</p>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View My Schedule
      </a>
    </body></html>`
  );
}

export async function sendEmployeeNewBookingNotice(opts: {
  employeeEmail: string;
  employeeName:  string;
  customerName:  string;
  shopName:      string;
  startTime:     string;
  timezone:      string;
  bookingId:     string;
  appUrl:        string;
}) {
  const datetime = formatDateTimeInZone(opts.startTime, opts.timezone);
  await send(
    'sendEmployeeNewBookingNotice',
    opts.employeeEmail,
    `New Booking on Your Schedule — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">New Booking</h2>
      <p>Hi ${opts.employeeName}, you have a new appointment.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName}</li>
        <li><strong>When:</strong> ${datetime}</li>
        <li><strong>Shop:</strong> ${opts.shopName}</li>
      </ul>
      <a href="${opts.appUrl}/employee" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View Schedule
      </a>
    </body></html>`
  );
}

export async function sendAdminNewBookingNotice(opts: {
  adminEmail:    string;
  shopName:      string;
  shopAddress?:  string | null;
  customerName:  string;
  customerEmail: string;
  serviceName:   string;
  barberName:    string;
  startTime:     string;
  timezone:      string;
  duration:      number;
  bookingId:     string;
  appUrl:        string;
}) {
  const datetime = formatDateTimeInZone(opts.startTime, opts.timezone);
  await send(
    'sendAdminNewBookingNotice',
    opts.adminEmail,
    `New Booking — ${opts.shopName}`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">New Booking</h2>
      <p>A new appointment has been made at <strong>${opts.shopName}</strong>.</p>
      <ul style="color:#d1d5db;line-height:2;">
        <li><strong>Customer:</strong> ${opts.customerName} (${opts.customerEmail})</li>
        <li><strong>Service:</strong> ${opts.serviceName}</li>
        <li><strong>Barber:</strong> ${opts.barberName}</li>
        <li><strong>When:</strong> ${datetime}</li>
        <li><strong>Duration:</strong> ${opts.duration} minutes</li>
      </ul>
      <a href="${opts.appUrl}/admin/bookings?id=${opts.bookingId}" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View Booking
      </a>
    </body></html>`
  );
}

export async function sendEmployeeDeletionSummary(opts: {
  adminEmail:   string;
  employeeName: string;
  shopName:     string;
  actions: Array<{
    customerName:   string;
    startTime:      string;
    timezone:       string;
    action:         'cancel' | 'offer_reschedule' | 'reassign';
    newBarberName?: string;
  }>;
  appUrl: string;
}) {
  const actionLabel = (a: typeof opts.actions[0]) => {
    if (a.action === 'cancel')           return 'Cancelled';
    if (a.action === 'offer_reschedule') return 'Reschedule offer sent';
    return `Reassigned to ${a.newBarberName ?? 'another barber'}`;
  };

  const rows = opts.actions.map((a) =>
    `<tr style="border-bottom:1px solid #2e2e2e;">
      <td style="padding:8px 12px;color:#d1d5db;">${a.customerName}</td>
      <td style="padding:8px 12px;color:#d1d5db;">${formatDateTimeInZone(a.startTime, a.timezone)}</td>
      <td style="padding:8px 12px;color:#9ca3af;">${actionLabel(a)}</td>
    </tr>`
  ).join('');

  await send(
    'sendEmployeeDeletionSummary',
    opts.adminEmail,
    `Employee Removed — ${opts.employeeName} (${opts.shopName})`,
    `<!DOCTYPE html><html><body style="background:#0f0f0f;color:#fff;font-family:Inter,Arial,sans-serif;padding:40px 20px;">
      <h2 style="color:#C9A84C;">Employee Removed</h2>
      <p><strong>${opts.employeeName}</strong> has been removed from <strong>${opts.shopName}</strong>. The following bookings were actioned:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #2e2e2e;border-radius:8px;overflow:hidden;margin:16px 0;">
        <thead><tr style="background:#1e1e1e;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;">Customer</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;">Appointment</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${opts.appUrl}/admin/bookings" style="background:#C9A84C;color:#0f0f0f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        View All Bookings
      </a>
    </body></html>`
  );
}
