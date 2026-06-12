import { createClient } from '@/lib/supabase/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';

// Handles Supabase OTP-style links:
//   - Email confirmations  (type=email)
//   - Invite completions   (type=invite)
//   - Password-reset links (type=recovery)
//   - Magic-link sign-ins  (type=magiclink)
//
// Supabase sends these as ?token_hash=…&type=… on the redirect URL.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type       = searchParams.get('type') as EmailOtpType | null;
  const next       = searchParams.get('next');

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      // Invite and password-recovery must go through set-password
      if (type === 'invite' || type === 'recovery') {
        redirect('/auth/set-password');
      }

      // Magic links and email confirmations → role-based dashboard (or ?next)
      if (next) redirect(next);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) redirect('/auth/login');

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      const dest =
        profile?.role === 'admin'
          ? '/admin'
          : profile?.role === 'employee'
          ? '/employee'
          : '/dashboard';

      redirect(dest);
    }

    // verifyOtp failed
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/auth/login?error=Invalid+confirmation+link');
}
