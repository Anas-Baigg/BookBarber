import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatTimeInZone(isoString: string, timezone: string): string {
  const date = parseISO(isoString);
  const zoned = toZonedTime(date, timezone);
  return format(zoned, 'h:mm a');
}

export function formatDateInZone(isoString: string, timezone: string): string {
  const date = parseISO(isoString);
  const zoned = toZonedTime(date, timezone);
  return format(zoned, 'EEEE, MMMM d, yyyy');
}

export function formatDateTimeInZone(isoString: string, timezone: string): string {
  const date = parseISO(isoString);
  const zoned = toZonedTime(date, timezone);
  return format(zoned, 'EEEE, MMMM d, yyyy • h:mm a');
}

/** Returns YYYY-MM-DD in the given timezone */
export function toLocalDateString(isoString: string, timezone: string): string {
  const date = parseISO(isoString);
  const zoned = toZonedTime(date, timezone);
  return format(zoned, 'yyyy-MM-dd');
}

export function validateEmail(email: string): boolean {
  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;

  // Block common disposable domains
  const disposableDomains = [
    'mailinator.com', 'guerrillamail.com', 'tempmail.com',
    'throwaway.email', 'yopmail.com', 'sharklasers.com',
    'guerrillamailblock.com', 'grr.la', 'spam4.me',
    '10minutemail.com', 'trashmail.com', 'dispostable.com',
  ];
  const domain = email.split('@')[1].toLowerCase();
  if (disposableDomains.includes(domain)) return false;

  return true;
}

export function getDayName(dayOfWeek: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek] ?? 'Unknown';
}
