import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSessionCookieName } from '@/lib/auth';

async function logoutAction() {
  'use server';
  const cookieStore = await cookies();
  cookieStore.delete(getSessionCookieName());
  redirect('/login');
}

export function Header() {
  return (
    <header className="border-b bg-white px-6 py-3 flex items-center justify-between">
      <div />
      <form action={logoutAction}>
        <Button variant="ghost" size="sm" type="submit">
          Logout
        </Button>
      </form>
    </header>
  );
}
