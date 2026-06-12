'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getDashboardUrl } from '@/lib/getDashboardUrl';

export default function BookingError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[booking]', error);
  }, [error]);

  // undefined = loading, null = unauthenticated, string = role
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const r =
          (session?.user?.user_metadata?.role as string | undefined) ??
          (session?.user?.app_metadata?.role as string | undefined) ??
          null;
        setRole(r);
      });
  }, []);

  // href="/" while loading (middleware redirects to correct dest); once role
  // resolves, use the explicit destination so the navigation is immediate.
  const dashHref = role === undefined ? '/' : getDashboardUrl(role);

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-xl font-bold mb-3">Could not load booking</h2>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          We could not load this booking. Please try refreshing or go back to your dashboard.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-gradient-gold text-dark font-semibold text-sm rounded-xl hover:opacity-90 transition-opacity"
          >
            Refresh Page
          </button>
          <Link
            href={dashHref}
            className="px-6 py-2.5 border border-dark-400 text-gray-300 font-semibold text-sm rounded-xl hover:border-gold hover:text-gold transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
