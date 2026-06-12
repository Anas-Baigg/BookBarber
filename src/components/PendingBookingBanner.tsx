'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Scissors, ArrowRight, X } from 'lucide-react';

const STORAGE_KEY = 'bb_pending_booking';

interface PendingBooking {
  shopSlug: string;
  employeeName: string | null;
  date: string;
  startTime: string;
}

export default function PendingBookingBanner() {
  const [pending, setPending] = useState<PendingBooking | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  if (!pending) return null;

  function dismiss() {
    sessionStorage.removeItem(STORAGE_KEY);
    setPending(null);
  }

  const dateLabel = new Date(pending.date + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex items-center gap-3 p-4 mb-6 bg-gold-muted border border-gold/30 rounded-xl">
      <div className="w-9 h-9 rounded-lg bg-gold/20 flex items-center justify-center flex-shrink-0">
        <Scissors className="w-4 h-4 text-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gold">You have an incomplete booking</p>
        <p className="text-xs text-gold/70 truncate">
          {pending.employeeName ? `With ${pending.employeeName}` : 'Any barber'} · {dateLabel}
        </p>
      </div>
      <Link
        href={`/shop/${pending.shopSlug}`}
        className="flex items-center gap-1 text-xs font-semibold text-dark bg-gradient-gold px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity flex-shrink-0"
      >
        Continue <ArrowRight className="w-3 h-3" />
      </Link>
      <button
        onClick={dismiss}
        className="text-gold/50 hover:text-gold transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
