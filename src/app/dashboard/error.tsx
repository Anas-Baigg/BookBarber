'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-xl font-bold mb-3">Something went wrong</h2>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          Something went wrong loading your dashboard. Please try refreshing the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 bg-gradient-gold text-dark font-semibold text-sm rounded-xl hover:opacity-90 transition-opacity"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
}
