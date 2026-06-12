import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import Badge from '@/components/ui/Badge';
import PendingBookingBanner from '@/components/PendingBookingBanner';
import PastBookingsSection from '@/components/customer/PastBookingsSection';
import { formatDateTimeInZone } from '@/lib/utils';
import type { BookingWithDetails } from '@/types';
import { AlertTriangle, Calendar, Clock, Scissors, ArrowRight, RotateCcw } from 'lucide-react';

export const metadata = { title: 'My Dashboard' };

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const now = new Date().toISOString();

  const [
    { data: profile },
    { data: upcomingRaw },
    { data: pendingReschedules },
    { data: recentForShops },
  ] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),

    // Fix 1: only upcoming (future, non-cancelled, non-pending_reschedule)
    supabase
      .from('bookings')
      .select(`
        id, status, start_time,
        employee:employees(id, name),
        shop:shops(id, name, timezone, slug)
      `)
      .eq('customer_id', user.id)
      .neq('status', 'cancelled')
      .neq('status', 'pending_reschedule')
      .gt('start_time', now)
      .order('start_time', { ascending: true }),

    // Fix 2: pending reschedule bookings — shown in prominent alert section
    supabase
      .from('bookings')
      .select(`
        id, start_time,
        employee:employees(id, name),
        shop:shops(id, name, timezone, slug)
      `)
      .eq('customer_id', user.id)
      .eq('status', 'pending_reschedule'),

    // Visited shops for the rebook section (small bounded query)
    supabase
      .from('bookings')
      .select('shop:shops(id, name, slug, address)')
      .eq('customer_id', user.id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const upcoming = (upcomingRaw as unknown as BookingWithDetails[]) ?? [];

  const pending = (pendingReschedules ?? []) as unknown as Array<{
    id: string;
    start_time: string;
    employee: { id: string; name: string } | null;
    shop: { id: string; name: string; timezone: string; slug: string } | null;
  }>;

  // Deduplicated list of shops the customer has visited (for rebook CTAs)
  const visitedShops = Array.from(
    new Map(
      (recentForShops ?? [])
        .map((b) => (b as unknown as { shop: { id: string; name: string; slug: string; address: string | null } | null }).shop)
        .filter((s): s is { id: string; name: string; slug: string; address: string | null } => !!s?.slug)
        .map((s) => [s.id, s])
    ).values()
  ).slice(0, 3);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Welcome back, {firstName}</h1>
          <p className="text-gray-400">Manage your appointments</p>
        </div>

        {/* Pending booking recovery banner (client component reads sessionStorage) */}
        <PendingBookingBanner />

        {/* Fix 2: Action Required — pending reschedule alert */}
        {pending.length > 0 && (
          <section className="mb-8">
            <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <h2 className="font-semibold text-amber-400">
                  Action Required
                </h2>
              </div>
              <div className="space-y-3">
                {pending.map((b) => {
                  const tz = b.shop?.timezone ?? 'UTC';
                  return (
                    <div
                      key={b.id}
                      className="flex items-center justify-between gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl flex-wrap"
                    >
                      <div>
                        <div className="font-medium text-sm">{b.shop?.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          with {b.employee?.name ?? 'a barber'} · {formatDateTimeInZone(b.start_time, tz)}
                        </div>
                        <div className="text-xs text-amber-400/80 mt-1">
                          Your barber is unavailable — please reschedule or cancel.
                        </div>
                      </div>
                      <Link
                        href={`/booking/${b.id}`}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-dark font-semibold text-xs rounded-lg hover:bg-amber-400 transition-colors"
                      >
                        View Appointment <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Upcoming */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gold" />
            Upcoming Appointments
            {upcoming.length > 0 && (
              <span className="text-xs text-gold bg-gold-muted px-2 py-0.5 rounded-full font-medium">
                {upcoming.length}
              </span>
            )}
          </h2>

          {upcoming.length === 0 ? (
            <EmptyUpcoming visitedShops={visitedShops} />
          ) : (
            <div className="space-y-3">
              {upcoming.map((booking) => (
                <BookingCard key={booking.id} booking={booking} />
              ))}
            </div>
          )}
        </section>

        {/* Rebook quick-access (only when no upcoming but has history) */}
        {upcoming.length === 0 && visitedShops.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-300">
              <RotateCcw className="w-4 h-4" />
              Book Again
            </h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {visitedShops.map((shop) => (
                <Link
                  key={shop.id}
                  href={`/shop/${shop.slug}`}
                  className="flex items-center gap-3 p-4 bg-dark-100 border border-dark-300 rounded-xl hover:border-gold/40 hover:bg-dark-200 transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-gold-muted border border-gold/20 flex items-center justify-center flex-shrink-0">
                    <Scissors className="w-4 h-4 text-gold" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-gold transition-colors">
                      {shop.name}
                    </div>
                    {shop.address && (
                      <div className="text-xs text-gray-500 truncate">{shop.address}</div>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gold ml-auto flex-shrink-0 transition-colors" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Fix 1: Past bookings — paginated client component */}
        <PastBookingsSection />
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function BookingCard({ booking }: { booking: BookingWithDetails }) {
  const timezone = booking.shop?.timezone ?? 'UTC';
  return (
    <Link
      href={`/booking/${booking.id}`}
      className="block p-5 bg-dark-100 border border-dark-300 rounded-xl hover:border-gold/30 transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-gold flex items-center justify-center flex-shrink-0">
            <Scissors className="w-5 h-5 text-dark" />
          </div>
          <div>
            <div className="font-semibold group-hover:text-gold transition-colors">
              {booking.shop?.name}
            </div>
            <div className="text-sm text-gray-400">
              with {booking.employee?.name ?? 'Any barber'}
            </div>
          </div>
        </div>
        <Badge status={booking.status} />
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-sm text-gray-400">
        <Clock className="w-3.5 h-3.5 text-gold" />
        {formatDateTimeInZone(booking.start_time, timezone)}
      </div>
    </Link>
  );
}

function EmptyUpcoming({
  visitedShops,
}: {
  visitedShops: Array<{ id: string; name: string; slug: string }>;
}) {
  if (visitedShops.length > 0) {
    return (
      <div className="text-center py-12 bg-dark-100 border border-dark-300 rounded-2xl">
        <Scissors className="w-10 h-10 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400 mb-2">No upcoming appointments</p>
        <p className="text-sm text-gray-500 mb-5">
          Time for a fresh cut? Book again at one of your regular shops.
        </p>
        <Link
          href={`/shop/${visitedShops[0].slug}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-gold text-dark text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
        >
          Book at {visitedShops[0].name}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  // Fix 5: first-time user — replace dead-end text with "Find a Shop" CTA
  return (
    <div className="text-center py-14 bg-dark-100 border border-dashed border-dark-400 rounded-2xl">
      <div className="w-14 h-14 rounded-2xl bg-gold-muted border border-gold/20 flex items-center justify-center mx-auto mb-4">
        <Scissors className="w-7 h-7 text-gold" />
      </div>
      <h3 className="font-semibold text-lg mb-2">No appointments yet</h3>
      <p className="text-gray-400 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
        Browse all barbershops and book your first appointment in under 60 seconds.
      </p>
      <Link
        href="/shops"
        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-gold text-dark text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity"
      >
        Find a Shop
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
