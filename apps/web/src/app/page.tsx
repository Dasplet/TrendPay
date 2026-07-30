'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { SplashScreen } from '@/components/SplashScreen';

export default function HomePage() {
  const router      = useRouter();
  const user        = useAuthStore(s => s.user);
  const refreshUser = useAuthStore(s => s.refreshUser);
  const [done, setDone] = useState(false);

  useEffect(() => { refreshUser().catch(() => {}); }, []);

  useEffect(() => {
    if (!done) return;
    if (user) router.replace(user.rol === 'admin' ? '/admin' : '/dashboard');
    else router.replace('/login');
  }, [done, user]);

  return <SplashScreen onDone={() => setDone(true)} />;
}
