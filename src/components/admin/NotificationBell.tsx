'use client';

// DEPLOYMENT NOTE: This component uses Supabase Realtime with a row-level filter
// (filter: `recipient_id=eq.${userId}`). Two separate steps are required:
//
// 1. Migration 019 runs `ALTER PUBLICATION supabase_realtime ADD TABLE notifications`
//    — this enables PostgreSQL change capture on the table.
//
// 2. Supabase Dashboard → Database → Replication → find the notifications table
//    and enable it. This second step activates per-row filter evaluation so only
//    notifications matching the subscriber's recipient_id are delivered. Without
//    this dashboard toggle the filter is ignored and all admins receive all
//    notifications.
//
// Both steps are required. The migration alone is not sufficient.

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Calendar, Clock, UserCheck, X } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/client';

type NotificationType =
  | 'new_booking'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'time_off_requested'
  | 'time_off_withdrawn'
  | 'employee_activated';

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

function getHref(type: NotificationType): string {
  switch (type) {
    case 'new_booking':
    case 'booking_cancelled':
    case 'booking_rescheduled':
      return '/admin/bookings';
    default:
      return '/admin/employees';
  }
}

function NotifIcon({ type }: { type: NotificationType }) {
  if (type === 'new_booking' || type === 'booking_cancelled' || type === 'booking_rescheduled') {
    return <Calendar className="w-4 h-4 text-gold flex-shrink-0" />;
  }
  if (type === 'time_off_requested' || type === 'time_off_withdrawn') {
    return <Clock className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  }
  return <UserCheck className="w-4 h-4 text-green-400 flex-shrink-0" />;
}

export default function NotificationBell({ userId }: { userId: string }) {
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

  // Realtime subscription — new INSERT rows are prepended to the list instantly.
  // See DEPLOYMENT NOTE at the top of this file: the Supabase Dashboard toggle
  // under Database → Replication must be enabled separately from the migration.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`admin-notifications-${userId}`)
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

  // Optimistic: remove from list immediately, then fire PATCH in background
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
