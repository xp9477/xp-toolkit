// Colors follow ShapeStyle / DynamicShapeStyle:
// https://scriptingapp.github.io/guide/Types/ShapeStyle
// https://scriptingapp.github.io/guide/Types/DynamicShapeStyle

export interface DynamicShapeStyle {
  light: string;
  dark: string;
}

export const UI = {
  ink: { light: "#1C1B18", dark: "#F2F4F7" },
  muted: { light: "#7A766F", dark: "#8B93A0" },
  faint: { light: "#B0ABA3", dark: "#5C6470" },
  rule: { light: "#E6E2DA", dark: "#1E2630" },
  track: { light: "#EDE9E2", dark: "#3F3E39" },
} satisfies Record<string, DynamicShapeStyle>;

export const Colors = {
  ok: { light: "#3E9A48", dark: "#7DCE78" },
  warn: { light: "#C56A12", dark: "#E08A2E" },
  bad: { light: "#C04040", dark: "#E07070" },
  ok5h: { light: "#0284C7", dark: "#38BDF8" },
} satisfies Record<string, DynamicShapeStyle>;

export function accentFor(remainingPct: number | null): DynamicShapeStyle {
  if (remainingPct == null) return UI.faint;
  if (remainingPct <= 8) return Colors.bad;
  if (remainingPct <= 22) return Colors.warn;
  return Colors.ok;
}

export function accentFor5h(remainingPct: number | null): DynamicShapeStyle {
  if (remainingPct == null) return UI.faint;
  if (remainingPct <= 8) return Colors.bad;
  if (remainingPct <= 22) return Colors.warn;
  return Colors.ok5h;
}

export function shortenHint(hint?: string | null): string {
  if (!hint) return "";
  let s = String(hint).trim();
  if (s === "即将重置" || s === "即将恢复" || s === "满") return s;
  s = s.replace(/后$/, "");
  s = s.replace(/小时/g, "h ");
  s = s.replace(/分(?:钟)?/g, "m ");
  s = s.replace(/\s+/g, "").trim();
  return s ? `${s}后` : hint;
}
