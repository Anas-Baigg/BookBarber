import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import { Scissors, Clock, Shield, Star, ArrowRight, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getDashboardUrl } from '@/lib/getDashboardUrl';

const features = [
  {
    icon: Clock,
    title: 'Real-Time Availability',
    description: 'See live slot availability based on your barber\'s schedule. No double-booking, ever.',
  },
  {
    icon: Shield,
    title: 'Instant Confirmation',
    description: 'Get a confirmation email the moment you book. Cancel or reschedule anytime.',
  },
  {
    icon: Star,
    title: 'Choose Your Barber',
    description: 'Pick your favorite barber or let us assign the next available one.',
  },
];

const benefits = [
  'Book in under 60 seconds',
  '25-minute precision appointments',
  'Email reminders included',
  'Easy cancel or reschedule',
  'No app download needed',
  'Works on any device',
];

export default async function LandingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let dashboardUrl = '/dashboard';
  let isStaff = false;
  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = (profileData as { role?: string } | null)?.role;
    dashboardUrl = getDashboardUrl(role);
    isStaff = role === 'admin' || role === 'employee';
  }
  const isAuthenticated = !!user;

  const bookCta = '/shops';

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gold/5 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-gold/3 blur-2xl rounded-full" />
          <div className="absolute top-0 right-0 w-96 h-96 bg-gold/3 blur-3xl rounded-full" />
          {/* Grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'linear-gradient(#C9A84C 1px, transparent 1px), linear-gradient(90deg, #C9A84C 1px, transparent 1px)',
              backgroundSize: '50px 50px',
            }}
          />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gold/20 bg-gold-muted text-gold text-sm font-medium mb-8">
            <Scissors className="w-3.5 h-3.5" />
            Premium Barbershop Booking
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
            Your Next Cut,<br />
            <span className="text-gradient-gold">Booked in Seconds</span>
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            BookBarber connects you with premium barbershops. See real-time availability,
            pick your barber, and confirm your appointment instantly.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {isStaff ? (
              <Link
                href={dashboardUrl}
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-gold text-dark font-bold rounded-xl text-lg hover:opacity-90 transition-opacity"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5" />
              </Link>
            ) : (
              <>
                <Link
                  href={bookCta}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-gold text-dark font-bold rounded-xl text-lg hover:opacity-90 transition-opacity"
                >
                  Book Your Cut
                  <ArrowRight className="w-5 h-5" />
                </Link>
                {isAuthenticated ? (
                  <Link
                    href={dashboardUrl}
                    className="inline-flex items-center gap-2 px-8 py-4 border border-dark-400 text-gray-300 hover:border-gold hover:text-gold rounded-xl text-lg transition-all"
                  >
                    Go to Dashboard
                  </Link>
                ) : (
                  <Link
                    href="/auth/login"
                    className="inline-flex items-center gap-2 px-8 py-4 border border-dark-400 text-gray-300 hover:border-gold hover:text-gold rounded-xl text-lg transition-all"
                  >
                    Sign In
                  </Link>
                )}
              </>
            )}
          </div>

          {/* Trust signals */}
          <div className="flex flex-wrap items-center justify-center gap-6 mt-12 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-gold" /> No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-gold" /> Free to book
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-gold" /> Cancel anytime
            </span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 border-t border-dark-300">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Everything you need, <span className="text-gradient-gold">nothing you don't</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-xl mx-auto">
              A clean, fast booking experience built for modern barbershops.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group p-8 rounded-2xl bg-dark-100 border border-dark-300 hover:border-gold/30 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gold-muted flex items-center justify-center mb-6 group-hover:bg-gold/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-gold" />
                </div>
                <h3 className="text-lg font-semibold mb-3">{feature.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-100 border-t border-dark-300">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                Built for the <span className="text-gradient-gold">modern barbershop</span>
              </h2>
              <p className="text-gray-400 mb-8 leading-relaxed">
                Whether you run one chair or ten, BookBarber gives you the tools to manage
                your schedule, your team, and your clients — all in one place.
              </p>
              {!isStaff && (
                <Link
                  href={bookCta}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-gold text-dark font-semibold rounded-lg hover:opacity-90 transition-opacity"
                >
                  Get Started Free
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {benefits.map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-center gap-2.5 p-4 rounded-xl bg-dark-200 border border-dark-400"
                >
                  <CheckCircle className="w-4 h-4 text-gold flex-shrink-0" />
                  <span className="text-sm text-gray-300">{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 border-t border-dark-300">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Ready for your next cut?
          </h2>
          <p className="text-gray-400 mb-8">
            Join BookBarber and book your appointment in under 60 seconds.
          </p>
          {isStaff ? (
            <Link
              href={dashboardUrl}
              className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-gold text-dark font-bold rounded-xl text-lg hover:opacity-90 transition-opacity"
            >
              Go to Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          ) : (
            <Link
              href={bookCta}
              className="inline-flex items-center gap-2 px-10 py-4 bg-gradient-gold text-dark font-bold rounded-xl text-lg hover:opacity-90 transition-opacity"
            >
              Book Now — It&apos;s Free
              <ArrowRight className="w-5 h-5" />
            </Link>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-300 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-gold flex items-center justify-center">
              <Scissors className="w-3 h-3 text-dark" />
            </div>
            <span className="font-semibold text-sm">
              Book<span className="text-gradient-gold">Barber</span>
            </span>
          </div>
          <p className="text-xs text-gray-600">© {new Date().getFullYear()} BookBarber. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
