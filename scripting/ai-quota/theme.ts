export interface DynamicColor {
  light: string;
  dark: string;
}

export const UI = {
  ink: { light: "#1C1B18", dark: "#F2F4F7" } as DynamicColor,
  muted: { light: "#7A766F", dark: "#8B93A0" } as DynamicColor,
  faint: { light: "#B0ABA3", dark: "#5C6470" } as DynamicColor,
  rule: { light: "#E6E2DA", dark: "#1E2630" } as DynamicColor,
  track: { light: "#EDE9E2", dark: "#3F3E39" } as DynamicColor,
};

export const Colors = {
  ok: { light: "#3E9A48", dark: "#7DCE78" } as DynamicColor,
  warn: { light: "#C56A12", dark: "#E08A2E" } as DynamicColor,
  bad: { light: "#C04040", dark: "#E07070" } as DynamicColor,
  ok5h: { light: "#0284C7", dark: "#38BDF8" } as DynamicColor,
};

export function ok(): DynamicColor {
  return Colors.ok;
}

export function warn(): DynamicColor {
  return Colors.warn;
}

export function bad(): DynamicColor {
  return Colors.bad;
}

export function ok5h(): DynamicColor {
  return Colors.ok5h;
}

export function accentFor(remainingPct: number | null): DynamicColor {
  if (remainingPct == null) return UI.faint;
  if (remainingPct <= 8) return Colors.bad;
  if (remainingPct <= 22) return Colors.warn;
  return Colors.ok;
}

export function accentFor5h(remainingPct: number | null): DynamicColor {
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
