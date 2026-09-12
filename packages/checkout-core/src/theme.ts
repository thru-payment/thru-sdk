import type { CSSProperties } from 'react';
import { themeToCssVars, type ThruTheme } from './core/theme.js';

// The implementation moved to ./core/theme.js so it can be consumed without
// React's types. This module is the React-typed face of it and keeps the
// published `themeToVars` / `mergeTheme` / `ThruTheme` surface identical.

export type { ThruTheme } from './core/theme.js';
export { mergeTheme, themeToCssVars, THRU_CSS_VARS } from './core/theme.js';

/** Convert a theme object to inline CSS variable declarations. */
export function themeToVars(theme?: ThruTheme): CSSProperties {
  return themeToCssVars(theme) as CSSProperties;
}
