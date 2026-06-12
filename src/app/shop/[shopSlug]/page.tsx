import { notFound } from 'next/navigation';
import { cache } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Navbar from '@/components/layout/Navbar';
import BookingWidget from '@/components/BookingWidget';
import type { Shop } from '@/types';
import { getDashboardUrl } from '@/lib/getDashboardUrl';
import { MapPin, Clock, Scissors, Store } from 'lucide-react';

interface PageProps {
  params: { shopSlug: string };
}

const getShopBySlug = cache(async (slug: string) => {
  const supabase = createClient();
  const { data } = await supabase
    .from('public_shops')
    .select('id, name, slug, address, timezone, default_open_time, default_close_time')
    .eq('slug', slug)
    .single();
  return data;
});

export async function generateMetadata({ params }: PageProps) {
  const shop = await getShopBySlug(params.shopSlug);
  return {
    title: shop ? `${shop.name} — Book Your Cut` : 'Shop Not Found',
    description: shop ? `Book your appointment at ${shop.name}${shop.address ? ` in ${shop.address}` : ''}.` : '',
  };
}

function formatTimeStr(t: string): string {
  const [hh, mm] = t.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
}

export default async function ShopPage({ params }: PageProps) {
  const shop = await getShopBySlug(params.shopSlug);

  if (!shop) {
    // Distinguish a soft-deleted shop from a never-existed slug
    const adminCheck = createAdminClient();
    const { data: deletedShop } = await adminCheck
      .from('shops')
      .select('name')
      .eq('slug', params.shopSlug)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (!deletedShop) notFound();

    return (
      <div className="min-h-screen bg-dark">
        <Navbar />
        <main className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-dark-100 border border-dark-300 flex items-center justify-center mx-auto mb-6">
            <Store className="w-8 h-8 text-gray-600" />
          </div>
          <h1 className="text-2xl font-bold mb-3">{deletedShop.name}</h1>
          <p className="text-gray-400 mb-2">This shop is no longer available for bookings.</p>
          <p className="text-gray-500 text-sm mb-8">
            It may have closed or moved. Try finding another barbershop near you.
          </p>
          <Link
            href="/shops"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-gold text-dark font-semibold hover:opacity-90 transition-opacity"
          >
            <Scissors className="w-4 h-4" />
            Find Another Shop
          </Link>
        </main>
      </div>
    );
  }

  const supabase = createClient();
  const [{ data: employees }, { data: { user } }] = await Promise.all([
    supabase.from('public_employees').select('id, name, bio').eq('shop_id', shop.id).order('name'),
    supabase.auth.getUser(),
  ]);

  let userRole: string | null = null;
  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    userRole = (profileData as { role?: string } | null)?.role ?? null;
  }
  const isStaff = userRole === 'admin' || userRole === 'employee';

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        {/* Shop header */}
        <div className="mb-10">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-gold flex items-center justify-center flex-shrink-0">
              <Scissors className="w-8 h-8 text-dark" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold">{shop.name}</h1>
              {shop.address && (
                <p className="text-gray-400 flex items-center gap-1.5 mt-2">
                  <MapPin className="w-4 h-4" />
                  {shop.address}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-gold" />
              {formatTimeStr(shop.default_open_time)} — {formatTimeStr(shop.default_close_time)}
            </span>
            <span className="flex items-center gap-1.5">
              <Scissors className="w-4 h-4 text-gold" />
              {employees?.length ?? 0} barber{employees?.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {isStaff ? (
          <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-dark-100 border border-dark-300 flex items-center justify-center mb-6">
              <Scissors className="w-7 h-7 text-gray-500" />
            </div>
            <h2 className="text-xl font-bold mb-3">This page is for customers only</h2>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              The booking flow is available to customers. Go to your dashboard to manage bookings and schedules.
            </p>
            <Link
              href={getDashboardUrl(userRole)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-gold text-dark font-semibold rounded-xl hover:opacity-90 transition-opacity"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Booking widget */}
            <div className="lg:col-span-2">
              <BookingWidget shop={shop as unknown as Shop} />
            </div>

            {/* Team sidebar */}
            <div className="space-y-4">
              <h2 className="font-semibold text-lg">Our Team</h2>
              {employees && employees.length > 0 ? (
                employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 p-4 bg-dark-100 border border-dark-300 rounded-xl"
                  >
                    <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold flex-shrink-0">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{emp.name}</div>
                      {emp.bio && (
                        <div className="text-xs text-gray-500 line-clamp-2">{emp.bio}</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No barbers listed yet.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
