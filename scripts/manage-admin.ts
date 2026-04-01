import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const [,, action, email, password] = process.argv;

async function main() {
  switch (action) {
    case 'add': {
      if (!email || !password) {
        console.log('Usage: npx tsx scripts/manage-admin.ts add <email> <password>');
        process.exit(1);
      }
      const hash = await bcrypt.hash(password, 12);
      const { error } = await supabase.from('admin_users').upsert(
        { email, password_hash: hash, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
      if (error) { console.error('Error:', error.message); process.exit(1); }
      console.log(`Admin ${email} created/updated.`);
      break;
    }

    case 'reset': {
      if (!email || !password) {
        console.log('Usage: npx tsx scripts/manage-admin.ts reset <email> <new-password>');
        process.exit(1);
      }
      const hash = await bcrypt.hash(password, 12);
      const { error, count } = await supabase.from('admin_users')
        .update({ password_hash: hash, updated_at: new Date().toISOString() })
        .eq('email', email);
      if (error) { console.error('Error:', error.message); process.exit(1); }
      console.log(`Password reset for ${email}.`);
      break;
    }

    case 'revoke': {
      if (!email) {
        console.log('Usage: npx tsx scripts/manage-admin.ts revoke <email>');
        process.exit(1);
      }
      const { error } = await supabase.from('admin_users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('email', email);
      if (error) { console.error('Error:', error.message); process.exit(1); }
      console.log(`Admin ${email} revoked.`);
      break;
    }

    case 'revoke-all': {
      const { error } = await supabase.from('admin_users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .neq('email', 'placeholder');
      if (error) { console.error('Error:', error.message); process.exit(1); }
      console.log('All admins revoked.');
      break;
    }

    case 'list': {
      const { data, error } = await supabase.from('admin_users')
        .select('email, is_active, created_at, updated_at')
        .order('created_at');
      if (error) { console.error('Error:', error.message); process.exit(1); }
      if (!data?.length) { console.log('No admin users found.'); break; }
      console.table(data);
      break;
    }

    default:
      console.log(`Admin user management

Usage: npx tsx scripts/manage-admin.ts <command> [args]

Commands:
  add <email> <password>     Create or update an admin
  reset <email> <password>   Reset an admin's password
  revoke <email>             Deactivate an admin
  revoke-all                 Deactivate all admins
  list                       Show all admin users`);
  }
}

main().catch(console.error);
