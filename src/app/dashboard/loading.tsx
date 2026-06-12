import Navbar from '@/components/layout/Navbar';

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-16">

        {/* Header */}
        <div className="mb-8 animate-pulse">
          <div className="h-8 w-52 bg-dark-300 rounded mb-2" />
          <div className="h-4 w-36 bg-dark-300 rounded" />
        </div>

        {/* Upcoming section */}
        <div className="mb-10">
          <div className="h-6 w-48 bg-dark-300 rounded mb-4 animate-pulse" />
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="p-5 bg-dark-100 border border-dark-300 rounded-xl animate-pulse"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-dark-300 flex-shrink-0" />
                    <div>
                      <div className="h-4 w-32 bg-dark-300 rounded mb-2" />
                      <div className="h-3 w-24 bg-dark-300 rounded" />
                    </div>
                  </div>
                  <div className="h-5 w-20 bg-dark-300 rounded-full" />
                </div>
                <div className="mt-3 h-3 w-44 bg-dark-300 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Past bookings section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="h-6 w-44 bg-dark-300 rounded animate-pulse" />
            <div className="h-7 w-28 bg-dark-300 rounded-lg animate-pulse" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="p-4 bg-dark-100/50 border border-dark-300/50 rounded-xl animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-dark-300 flex-shrink-0" />
                    <div>
                      <div className="h-4 w-28 bg-dark-300 rounded mb-1.5" />
                      <div className="h-3 w-40 bg-dark-300 rounded" />
                    </div>
                  </div>
                  <div className="h-5 w-16 bg-dark-300 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
