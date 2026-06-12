"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import type { Profile } from "@/types";
import { Scissors, LogOut, Menu, X } from "lucide-react";
import EmployeeNotificationBell from "@/components/employee/EmployeeNotificationBell";

export default function Navbar() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId]   = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function fetchAndSetProfile(uid: string) {
      setUserId(uid);
      const { data } = await supabase
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', uid)
        .single();
      if (data) {
        const p = data as { role: string; full_name: string | null; email: string };
        setProfile({
          id:         uid,
          email:      p.email ?? '',
          full_name:  p.full_name ?? null,
          role:       p.role as Profile['role'],
          created_at: '',
        });
      }
    }

    // Initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) fetchAndSetProfile(session.user.id);
    });

    // Cross-tab sign-out and token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setProfile(null);
        setUserId(null);
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session.user) {
        fetchAndSetProfile(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const dashboardHref =
    profile?.role === "admin"
      ? "/admin"
      : profile?.role === "employee"
        ? "/employee"
        : "/dashboard";

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-dark/80 backdrop-blur-md border-b border-dark-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-gold flex items-center justify-center">
              <Scissors className="w-4 h-4 text-dark" />
            </div>
            <span className="font-bold text-lg tracking-tight">
              Book<span className="text-gradient-gold">Barber</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-4">
            {/* Find a Shop — customers and unauthenticated visitors only */}
            {(profile?.role === 'customer' || !profile) && (
              <Link
                href="/shops"
                className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-2"
              >
                Find a Shop
              </Link>
            )}
            {profile ? (
              <>
                <Link
                  href={dashboardHref}
                  className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-2"
                >
                  Dashboard
                </Link>
                {profile.role === 'employee' && (
                  <Link
                    href="/employee/profile"
                    className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-2"
                  >
                    My Profile
                  </Link>
                )}
                {profile.role === 'customer' && (
                  <Link
                    href="/dashboard/profile"
                    className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-2"
                  >
                    My Profile
                  </Link>
                )}
                <span className="text-xs text-gray-600">{profile.email}</span>
                {profile.role === 'employee' && userId && (
                  <EmployeeNotificationBell userId={userId} />
                )}
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors px-3 py-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="text-sm text-gray-300 hover:text-white transition-colors px-4 py-2"
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/signup"
                  className="text-sm font-semibold bg-gradient-gold text-dark px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
                >
                  Book Now
                </Link>
              </>
            )}
          </div>

          {/* Mobile: bell (employees only) + hamburger — always visible */}
          <div className="md:hidden flex items-center gap-1">
            {profile?.role === 'employee' && userId && (
              <EmployeeNotificationBell userId={userId} />
            )}
            <button
              className="text-gray-400 hover:text-white"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-dark-100 border-t border-dark-300 px-4 py-4 space-y-2">
          {/* Find a Shop — customers and unauthenticated visitors only */}
          {(profile?.role === 'customer' || !profile) && (
            <Link
              href="/shops"
              className="block text-sm text-gray-300 hover:text-white py-2"
              onClick={() => setMenuOpen(false)}
            >
              Find a Shop
            </Link>
          )}
          {profile ? (
            <>
              <Link
                href={dashboardHref}
                className="block text-sm text-gray-300 hover:text-white py-2"
                onClick={() => setMenuOpen(false)}
              >
                Dashboard
              </Link>
              {profile.role === 'employee' && (
                <Link
                  href="/employee/profile"
                  className="block text-sm text-gray-300 hover:text-white py-2"
                  onClick={() => setMenuOpen(false)}
                >
                  My Profile
                </Link>
              )}
              {profile.role === 'customer' && (
                <Link
                  href="/dashboard/profile"
                  className="block text-sm text-gray-300 hover:text-white py-2"
                  onClick={() => setMenuOpen(false)}
                >
                  My Profile
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 text-sm text-red-400 py-2"
              >
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="block text-sm text-gray-300 hover:text-white py-2"
                onClick={() => setMenuOpen(false)}
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="block text-sm font-semibold text-gold py-2"
                onClick={() => setMenuOpen(false)}
              >
                Book Now
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
