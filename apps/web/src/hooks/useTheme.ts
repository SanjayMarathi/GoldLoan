import { useCallback, useEffect, useState } from 'react';
import { readString, writeString } from '../lib/storage.ts';

export type Theme = 'light' | 'dark';

const THEME_COLOR: Record<Theme, string> = { light: '#faf8f3', dark: '#09090b' };

// Light (gold & white) is the default; dark (gold & black) only when the user picks it.
function initialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'dark' || attr === 'light') return attr;
  return readString('gl-theme') === 'dark' ? 'dark' : 'light';
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    writeString('gl-theme', t);
    setThemeState(t);
  }, []);

  return { theme, setTheme };
}
