'use client';

// DEPLOYMENT NOTE: Requires the same Supabase Dashboard toggle as the admin bell.
// Database → Replication → enable the notifications table under the realtime publication.
// Migration 020 adds the time_off_approved and time_off_denied type values to the DB constraint.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Calendar, Clock, X } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';

type NotificationType =
  | 'new_booking'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'time_off_approved'
  | 'time_off_denied';

type Notification = {
  id:           string;
  shop_id:      string;
  recipient_id: string;
  type:         NotificationType;
  title:        string;
  body:         string;
  booking_id:   string | null;
  employee_id:  string | null;
  is_read:      boolean;
  created_at:   string;
};

function getHref(_type: NotificationType): string {
  return '/employee';
}

function NotifIcon({ type }: { type: NotificationType }) {
  if (type === 'new_booking' || type === 'booking_cancelled' || type === 'booking_rescheduled') {
    return <Calendar className="w-4 h-4 text-gold flex-shrink-0" />;
  }
  if (type === 'time_off_approved') {
    return <Clock className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  }
  return <Clock className="w-4 h-4 text-red-400 flex-shrink-0" />;
}

export default function EmployeeNotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen]               = useState(false);
  const [loading, setLoading]             = useState(true);
  const dropdownRef                       = useRef<HTMLDivElement>(null);
  const router                            = useRouter();

  // Initial fetch of unread notifications
  useEffect(() => {
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setNotifications(data as Notification[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Realtime subscription — new INSERT rows are prepended instantly
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`employee-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setNotifications((prev) => [n, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  const unreadCount = notifications.length;
  const badge       = unreadCount > 99 ? '99+' : String(unreadCount);

  function handleClick(n: Notification) {
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    setIsOpen(false);
    fetch('/api/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: n.id }),
    }).catch(() => {});
    router.push(getHref(n.type));
  }

  function handleMarkAllRead() {
    setNotifications([]);
    fetch('/api/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button with badge */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-200 transition-all"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {badge}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-dark-100 border border-dark-300 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-300">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-gold hover:text-gold/80 transition-colors"
                >
                  Mark all as read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-dark-300/50">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 gap-2">
                <Bell className="w-8 h-8 text-gray-600" />
                <p className="text-sm text-gray-500">All caught up</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-dark-200 transition-colors text-left"
                >
                  {/* Unread dot */}
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                  {/* Type icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    <NotifIcon type={n.type} />
                  </div>
                  {/* Text content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">{n.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed break-words">{n.body}</p>
                    <p className="text-[11px] text-gray-600 mt-1">
                      {formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
