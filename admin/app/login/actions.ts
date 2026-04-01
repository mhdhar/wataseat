'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { createSession, getSessionCookieName } from '@/lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function loginAction(formData: FormData) {
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  // Look up admin in Supabase
  const { data: admin, error } = await supabase
    .from('admin_users')
    .select('id, email, password_hash, is_active')
    .eq('email', email)
    .single();

  if (error || !admin) {
    return { error: 'Invalid credentials' };
  }

  if (!admin.is_active) {
    return { error: 'Account deactivated' };
  }

  // Verify password
  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    return { error: 'Invalid credentials' };
  }

  const token = await createSession();
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  redirect('/');
}
