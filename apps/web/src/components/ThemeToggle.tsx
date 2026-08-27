'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'tp-theme';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
  }

  return { theme, toggle };
}

export function ThemeToggle({ className = 'tp-theme-toggle', iconSize = 19 }: { className?: string; iconSize?: number }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      onClick={toggle}
      className={className}
    >
      {theme === 'dark' ? <Sun size={iconSize} /> : <Moon size={iconSize} />}
    </button>
  );
}
