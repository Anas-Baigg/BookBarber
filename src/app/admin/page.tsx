import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { Store, Users, CalendarRange, TrendingUp, Clock, Calendar } from "lucide-react";
import { formatDateTimeInZone } from "@/lib/utils";
import { getTodayBoundsUTC } from "@/lib/booking-time";
import { format } from "date-fns";
import type { BookingWithDetails } from "@/types";

export const metadata = { title: "Admin Overview" };

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function AdminOverviewPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  // Fetch all shops owned by this admin
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, timezone")
    .eq("owner_id", user.id)
    .is("deleted_at", null);

  const shopIds = shops?.map((s) => s.id) ?? [];

  // Fetch employee count
  const { count: employeeCount } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .in("shop_id", shopIds);

  // Fetch active (non-cancelled) bookings for stats
  const { data: allBookings, count: totalBookings } = await supabase
    .from("bookings")
    .select("*", { count: "exact" })
    .in("shop_id", shopIds)
    .in("status", ["confirmed", "rescheduled", "checked_in", "pending_reschedule"]);

  // "Today" uses UTC day boundaries — admin spans multiple shops/timezones,
  // UTC midnight is the most consistent approximation for a stats widget.
  const { start: todayStart, end: todayEnd } = getTodayBoundsUTC(shops?.[0]?.timezone ?? "UTC");
  const todayCount =
    allBookings?.filter((b) => {
      const t = new Date(b.start_time);
      return t >= todayStart && t <= todayEnd;
    }).length ?? 0;

  // Pending time off requests (RLS scopes to admin's shops automatically)
  const { data: pendingTimeOff } = await supabase
    .from("time_off_requests")
    .select("*, employee:employees(name, shop:shops(name))")
    .eq("status", "pending")
    .order("date", { ascending: true })
    .limit(10);

  // Recent bookings (last 5)
  const { data: recentBookings } = await supabase
    .from("bookings")
    .select(
      `
      *,
      employee:employees(id, name),
      shop:shops(id, name, timezone),
      customer:profiles!bookings_customer_id_fkey(id, full_name, email)
    `,
    )
    .in("shop_id", shopIds)
    .order("created_at", { ascending: false })
    .limit(5);

  const stats = [
    {
      label: "Total Shops",
      value: shops?.length ?? 0,
      icon: Store,
      color: "text-blue-400",
    },
    {
      label: "Total Barbers",
      value: employeeCount ?? 0,
      icon: Users,
      color: "text-purple-400",
    },
    {
      label: "Active Bookings",
      value: totalBookings ?? 0,
      icon: CalendarRange,
      color: "text-gold",
    },
    {
      label: "Upcoming Today",
      value: todayCount,
      icon: TrendingUp,
      color: "text-green-400",
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">
          {getGreeting()}, {profile?.full_name?.split(" ")[0] ?? "Admin"}
        </h1>
        <p className="text-gray-400">
          Here's what's happening across your shops.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label} className="flex flex-col gap-3">
            <div
              className={`w-9 h-9 rounded-lg bg-dark-300 flex items-center justify-center`}
            >
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Time Off Requests */}
      {pendingTimeOff && pendingTimeOff.length > 0 && (
        <Card className="mb-6 border-yellow-500/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-yellow-400" />
              Pending Time Off Requests
              <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
                {pendingTimeOff.length}
              </span>
            </h2>
            <Link
              href="/admin/employees"
              className="text-xs text-gold hover:text-gold-light transition-colors"
            >
              Review all →
            </Link>
          </div>
          <div className="space-y-2">
            {pendingTimeOff.map((req) => {
              const emp  = (req.employee as unknown) as { name: string; shop: { name: string } | null } | null;
              return (
                <div key={req.id} className="flex items-center justify-between py-2 px-3 bg-dark-200 rounded-lg">
                  <div>
                    <span className="text-sm font-medium">{emp?.name ?? 'Unknown'}</span>
                    <span className="text-gray-500 text-xs mx-1.5">·</span>
                    <span className="text-xs text-gray-500">{emp?.shop?.name}</span>
                    <div className="text-xs text-yellow-400 mt-0.5">
                      {format(new Date(req.date + 'T12:00:00'), 'EEE, MMM d')}
                    </div>
                    <div className="text-xs text-gray-400 truncate max-w-xs">{req.reason}</div>
                  </div>
                  <Link
                    href="/admin/employees"
                    className="text-xs px-3 py-1 rounded-lg bg-dark-300 text-gray-300 hover:text-white transition-colors flex-shrink-0"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Recent bookings */}
      <Card>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold" />
            Recent Bookings
          </h2>
          <Link
            href="/admin/bookings"
            className="text-xs text-gold hover:text-gold-light transition-colors"
          >
            View all →
          </Link>
        </div>

        {!recentBookings || recentBookings.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No bookings yet.</p>
        ) : (
          <div className="space-y-2">
            {(recentBookings as BookingWithDetails[]).map((b) => {
              const tz = b.shop?.timezone ?? "UTC";
              return (
                <Link
                  key={b.id}
                  href={`/admin/bookings?id=${b.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-dark-200 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center text-xs font-bold text-gold">
                      {b.customer?.full_name?.charAt(0) ?? "?"}
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {b.customer?.full_name ?? "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {b.shop?.name} · {b.employee?.name}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gold">
                      {formatDateTimeInZone(b.start_time, tz)}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${
                        b.status === "confirmed"
                          ? "text-green-400"
                          : b.status === "cancelled"
                            ? "text-red-400"
                            : "text-blue-400"
                      }`}
                    >
                      {b.status}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
