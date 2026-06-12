import Navbar from '@/components/layout/Navbar';

export default function BookingLoading() {
  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-24 pb-16">

        {/* Status banner skeleton */}
        <div className="h-14 bg-dark-100 border border-dark-300 rounded-xl mb-6 animate-pulse" />

        {/* Main card */}
        <div className="bg-dark-100 border border-dark-300 rounded-2xl overflow-hidden animate-pulse">

          {/* Card header */}
          <div className="p-6 border-b border-dark-300 flex items-start justify-between">
            <div>
              <div className="h-5 w-36 bg-dark-300 rounded mb-2" />
              <div className="h-3 w-20 bg-dark-300 rounded" />
            </div>
            <div className="h-6 w-20 bg-dark-300 rounded-full" />
          </div>

          {/* Detail rows */}
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-dark-300 flex-shrink-0" />
                  <div>
                    <div className="h-3 w-12 bg-dark-300 rounded mb-1.5" />
                    <div className="h-4 w-28 bg-dark-300 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-6 border-t border-dark-300 flex gap-3">
            <div className="h-9 w-24 bg-dark-300 rounded-lg" />
            <div className="h-9 w-28 bg-dark-300 rounded-lg" />
          </div>

        </div>

        {/* Back link */}
        <div className="mt-6 flex justify-center">
          <div className="h-4 w-32 bg-dark-300 rounded animate-pulse" />
        </div>

      </main>
    </div>
  );
}
