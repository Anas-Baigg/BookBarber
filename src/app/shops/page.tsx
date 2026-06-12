import { createClient } from '@/lib/supabase/server';
import Navbar from '@/components/layout/Navbar';
import Link from 'next/link';
import { MapPin, Clock, Scissors, ArrowRight } from 'lucide-react';

export const metadata = { title: 'Find a Shop — BookBarber' };

// Converts raw PostgreSQL TIME like "09:00:00" to "9:00 AM"
function formatTimeStr(t: string): string {
  const [hh, mm] = t.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
}

export default async function ShopsPage() {
  const supabase = createClient();
  const { data: shops } = await supabase
    .from('public_shops')
    .select('id, name, slug, address, default_open_time, default_close_time')
    .order('name');

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Find a Shop</h1>
          <p className="text-gray-400">Browse all barbershops and book your next appointment.</p>
        </div>

        {!shops || shops.length === 0 ? (
          <div className="text-center py-16 bg-dark-100 border border-dark-300 rounded-2xl">
            <Scissors className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No shops are available yet.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {shops.map((shop) => (
              <div
                key={shop.id}
                className="flex flex-col bg-dark-100 border border-dark-300 rounded-2xl overflow-hidden hover:border-gold/30 transition-all group"
              >
                <div className="p-6 flex-1">
                  <div className="w-12 h-12 rounded-xl bg-gradient-gold flex items-center justify-center mb-4">
                    <Scissors className="w-6 h-6 text-dark" />
                  </div>
                  <h2 className="font-bold text-lg mb-2 group-hover:text-gold transition-colors">
                    {shop.name}
                  </h2>
                  {shop.address && (
                    <p className="flex items-start gap-1.5 text-sm text-gray-400 mb-2">
                      <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                      {shop.address}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5 text-sm text-gray-500">
                    <Clock className="w-4 h-4 text-gold flex-shrink-0" />
                    {formatTimeStr(shop.default_open_time)} — {formatTimeStr(shop.default_close_time)}
                  </p>
                </div>
                <div className="px-6 pb-6">
                  <Link
                    href={`/shop/${shop.slug}`}
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-gradient-gold text-dark font-semibold text-sm rounded-xl hover:opacity-90 transition-opacity"
                  >
                    Book Now <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
