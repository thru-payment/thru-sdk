import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createThruClient, type ThruClient } from './client';
import type { ThruTheme } from './theme';

const DEFAULT_BASE_URL = 'https://api.thru.la/v1';

type ThruContextValue = {
  client: ThruClient;
  theme?: ThruTheme;
};

const ThruContext = createContext<ThruContextValue | null>(null);

export function ThruProvider({
  apiBaseUrl = DEFAULT_BASE_URL,
  theme,
  children,
}: {
  /** thru API base, e.g. https://api.thru.la/v1 */
  apiBaseUrl?: string;
  /** Default theme applied to every thru widget below this provider. */
  theme?: ThruTheme;
  children: ReactNode;
}) {
  const value = useMemo<ThruContextValue>(
    () => ({ client: createThruClient(apiBaseUrl), theme }),
    [apiBaseUrl, theme],
  );
  return <ThruContext.Provider value={value}>{children}</ThruContext.Provider>;
}

export function useThru(): ThruContextValue {
  const ctx = useContext(ThruContext);
  if (!ctx) {
    throw new Error('thru components must be wrapped in <ThruProvider>.');
  }
  return ctx;
}
