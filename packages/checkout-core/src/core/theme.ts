// Theme tokens, with no React in sight.
//
// The root entry's `themeToVars` returns React's `CSSProperties`, which drags a
// `react` type dependency into the .d.ts. That is fine for the React entry and
// fatal for a Vue app that has no `@types/react` installed, so the actual logic
// lives here returning a plain `Record<string, string>` — assignable to a Vue
// `:style` binding, a Svelte `style:` directive, or `Object.assign(el.style)`.

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

/** Token name -> CSS custom property name. */
export const THRU_CSS_VARS: Readonly<Record<keyof ThruTheme, string>> = {
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

/**
 * Convert a theme object to CSS custom property declarations.
 *
 * The React entry re-exports this as `themeToVars`, typed as `CSSProperties`.
 */
export function themeToCssVars(theme?: ThruTheme): Record<string, string> {
  const style: Record<string, string> = {};
  if (theme) {
    for (const key of Object.keys(theme) as (keyof ThruTheme)[]) {
      const value = theme[key];
      if (value != null) style[THRU_CSS_VARS[key]] = value;
    }
  }
  return style;
}

export function mergeTheme(base?: ThruTheme, override?: ThruTheme): ThruTheme | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}
