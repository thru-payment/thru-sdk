import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createThruClient, DEFAULT_API_BASE_URL, type ThruClient } from './client.js';
import type { ThruTheme } from './theme.js';

type ThruContextValue = {
  client: ThruClient;
  theme?: ThruTheme;
};

const ThruContext = createContext<ThruContextValue | null>(null);

export function ThruProvider({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  client,
  theme,
  children,
}: {
  /** thru API base, e.g. https://api.thru.la/v1 */
  apiBaseUrl?: string;
  /**
   * Bring your own client instead of one built from `apiBaseUrl` — useful for
   * tests, for a caching or authenticating wrapper, or for sharing one client
   * with non-React code driving the stores from `/core`. Wins over `apiBaseUrl`.
   */
  client?: ThruClient;
  /** Default theme applied to every thru widget below this provider. */
  theme?: ThruTheme;
  children: ReactNode;
}) {
  const value = useMemo<ThruContextValue>(
    () => ({ client: client ?? createThruClient(apiBaseUrl), theme }),
    [apiBaseUrl, client, theme],
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

/**
 * Like `useThru`, but returns `null` outside a provider instead of throwing.
 * The hooks read the context through this so that passing an explicit `client`
 * works with no `<ThruProvider>` anywhere in the tree.
 */
export function useOptionalThru(): ThruContextValue | null {
  return useContext(ThruContext);
}
