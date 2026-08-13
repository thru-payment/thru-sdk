import { type CSSProperties, type ReactNode } from 'react';
import { cn } from '../cn';
import { useThru } from '../provider';
import { mergeTheme, themeToVars, type ThruTheme } from '../theme';

/**
 * Hosts the thru CSS variables and base class for a subtree. Wrap custom layouts
 * built from the primitives in this. Top-level widgets render their own root.
 */
export function ThruRoot({
  unstyled,
  className,
  style,
  theme,
  children,
}: {
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
  theme?: ThruTheme;
  children: ReactNode;
}) {
  const { theme: providerTheme } = useThru();
  const vars = themeToVars(mergeTheme(providerTheme, theme));
  return (
    <div className={cn(!unstyled && 'thru-root', className)} style={{ ...vars, ...style }}>
      {children}
    </div>
  );
}

/** Compose a part's classes: base class (unless `unstyled`) + slot override + extra. */
export function partClass(
  unstyled: boolean | undefined,
  base: string,
  slot?: string,
  extra?: string,
): string {
  return cn(!unstyled && base, slot, extra);
}
