/**
 * One-time script: sets app_metadata.role = 'admin' for every admin in profiles.
 *
 * Without this, admins whose accounts were created before app_metadata.role was
 * being set will not have the role claim in their JWT. The Navbar and login page
 * now fall back to a DB query, so the app works either way — but setting this
 * ensures the fast JWT path works and avoids the extra DB round-trip per login.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx ts-node --project tsconfig.json src/scripts/set-admin-app-metadata.ts
 *
 * Or load from .env.local first:
 *   npx dotenv -e .env.local -- npx ts-node --project tsconfig.json src/scripts/set-admin-app-metadata.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: admins, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin');

  if (error) {
    console.error('Failed to fetch admin profiles:', error.message);
    process.exit(1);
  }

  const count = admins?.length ?? 0;
  console.log(`Found ${count} admin account(s)`);

  for (const admin of admins ?? []) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      admin.id,
      { app_metadata: { role: 'admin' } }
    );
    if (updateError) {
      console.error(`  ✗ ${admin.id}: ${updateError.message}`);
    } else {
      console.log(`  ✓ ${admin.id}`);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
