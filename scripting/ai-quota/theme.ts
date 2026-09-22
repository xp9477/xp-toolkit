export type AccentColor =
  | "systemGreen"
  | "systemOrange"
  | "systemRed"
  | "systemBlue"
  | "secondaryLabel";

export const UI = {
  ink: "label" as const,
  muted: "secondaryLabel" as const,
  faint: "tertiaryLabel" as const,
  rule: "separator" as const,
  track: "tertiarySystemFill" as const,
};

export const Colors = {
  ok: "systemGreen" as const,
  warn: "systemOrange" as const,
  bad: "systemRed" as const,
  ok5h: "systemBlue" as const,
};

export function ok(): AccentColor {
  return Colors.ok;
}

export function warn(): AccentColor {
  return Colors.warn;
}

export function bad(): AccentColor {
  return Colors.bad;
}

export function ok5h(): AccentColor {
  return Colors.ok5h;
}

export function accentFor(remainingPct: number | null): AccentColor {
  if (remainingPct == null) return "secondaryLabel";
  if (remainingPct <= 8) return Colors.bad;
  if (remainingPct <= 22) return Colors.warn;
  return Colors.ok;
}

export function accentFor5h(remainingPct: number | null): AccentColor {
  if (remainingPct == null) return "secondaryLabel";
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
