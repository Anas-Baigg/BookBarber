import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'BookBarber <onboarding@resend.dev>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, email, bio, shopId } = await request.json();

  if (!name || !email || !shopId) {
    return NextResponse.json({ error: 'name, email, and shopId are required' }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Verify admin owns this shop
  const { data: shop } = await adminClient
    .from('shops')
    .select('id, name')
    .eq('id', shopId)
    .eq('owner_id', user.id)
    .single();

  if (!shop) {
    return NextResponse.json({ error: 'Shop not found or access denied' }, { status: 404 });
  }

  // Check if user already exists
  const { data: existingProfiles } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .limit(1);

  let employeeUserId: string | null = null;
  let isExistingUser = false;

  if (existingProfiles && existingProfiles.length > 0) {
    isExistingUser = true;
    // User exists — update their role to employee
    employeeUserId = existingProfiles[0].id;
    await adminClient
      .from('profiles')
      .update({ role: 'employee' })
      .eq('id', employeeUserId);

    if (employeeUserId) {
      // Fix 5B: write role to app_metadata (cannot be set by the user themselves)
      await adminClient.auth.admin.updateUserById(employeeUserId, {
        app_metadata: { role: 'employee' },
      });

      // Fix 5C: invalidate their current session so they receive a fresh JWT with the correct role
      await adminClient.auth.admin.signOut(employeeUserId, 'global');

      // Notify them to log in again, including the shop name per Fix 4
      const shopName = (shop as unknown as { name?: string })?.name ?? '';
      try {
        await resend.emails.send({
          from: FROM,
          to: email,
          subject: 'Your BookBarber account has been updated',
          html: `<p>Hi ${name},</p><p>Your BookBarber account has been upgraded to an employee account at <strong>${shopName}</strong>. Please log in again to access your employee dashboard at <a href="${APP_URL}/employee">${APP_URL}/employee</a>.</p><p>If you did not expect this, please contact ${shopName} directly.</p><p><a href="${APP_URL}/auth/login">Log in here</a></p>`,
        });
      } catch (err) {
        console.error('[employees POST] role-change email failed:', err);
      }
    }
  } else {
    // Invite new user via Supabase Admin
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: name,
          role: 'employee',
        },
        // Must point to /auth/callback — that page extracts #access_token
        // from the URL hash (implicit flow) and routes to /auth/set-password
        redirectTo: `${APP_URL}/auth/callback`,
      }
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    employeeUserId = inviteData.user?.id ?? null;

    // Fix 5B: write role to app_metadata after invite (user_metadata can be written by the user)
    if (employeeUserId) {
      await adminClient.auth.admin.updateUserById(employeeUserId, {
        app_metadata: { role: 'employee' },
      });
    }
  }

  // Create employee record
  const { data: employee, error: empError } = await adminClient
    .from('employees')
    .insert({
      user_id:             employeeUserId,
      shop_id:             shopId,
      name,
      bio:                 bio || null,
      invite_email:        email,
      activated_notified:  isExistingUser, // converted customers are already active
    })
    .select()
    .single();

  if (empError) {
    return NextResponse.json({ error: empError.message }, { status: 500 });
  }

  // Create default schedules (Mon-Fri 9-18, off on weekends)
  const schedules = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    employee_id: employee.id,
    day_of_week: day,
    start_time: '09:00',
    end_time: '18:00',
    is_off: day === 0 || day === 6, // Sunday and Saturday off by default
  }));

  await adminClient.from('employee_schedules').insert(schedules);

  return NextResponse.json(employee, { status: 201 });
}
