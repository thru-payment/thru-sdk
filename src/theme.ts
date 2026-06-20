import type { CSSProperties } from 'react';

/**
 * Theme tokens. Every value maps to a CSS custom property, so you can theme via
 * this object, by setting the variables yourself, or with per-part `classNames`.
 */
export type ThruTheme = Partial<{
  colorBg: string;
  colorSurface: string;
  colorBorder: string;
  colorText: string;
  colorMuted: string;
  colorAccent: string;
  colorAccentText: string;
  colorSuccess: string;
  colorWarning: string;
  colorDanger: string;
  radius: string;
  fontFamily: string;
  fontMono: string;
  spacing: string;
}>;

const CSS_VAR: Record<keyof ThruTheme, string> = {
  colorBg: '--thru-bg',
  colorSurface: '--thru-surface',
  colorBorder: '--thru-border',
  colorText: '--thru-text',
  colorMuted: '--thru-muted',
  colorAccent: '--thru-accent',
  colorAccentText: '--thru-accent-text',
  colorSuccess: '--thru-success',
  colorWarning: '--thru-warning',
  colorDanger: '--thru-danger',
  radius: '--thru-radius',
  fontFamily: '--thru-font',
  fontMono: '--thru-font-mono',
  spacing: '--thru-space',
};

/** Convert a theme object to inline CSS variable declarations. */
export function themeToVars(theme?: ThruTheme): CSSProperties {
  const style: Record<string, string> = {};
  if (theme) {
    for (const key of Object.keys(theme) as (keyof ThruTheme)[]) {
      const value = theme[key];
      if (value != null) style[CSS_VAR[key]] = value;
    }
  }
  return style as CSSProperties;
}

export function mergeTheme(base?: ThruTheme, override?: ThruTheme): ThruTheme | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}
