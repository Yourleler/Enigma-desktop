export interface YuanVisual {
  yuan: string;
  symbol: string;
  moodLabel: string;
  accent: string;
  avatar: string;
}

const FALLBACK_YUAN = "hanako";

export const YUAN_VISUALS: Readonly<Record<string, Readonly<YuanVisual>>> =
  Object.freeze({
    hanako: Object.freeze({
      yuan: "hanako",
      symbol: "✿",
      moodLabel: "MOOD",
      accent: "#537D96",
      avatar: "Hanako.png",
    }),
    butter: Object.freeze({
      yuan: "butter",
      symbol: "❊",
      moodLabel: "PULSE",
      accent: "#5BA88C",
      avatar: "Butter.png",
    }),
    ming: Object.freeze({
      yuan: "ming",
      symbol: "◈",
      moodLabel: "REFLECT",
      accent: "#8BA4B4",
      avatar: "Ming.png",
    }),
    // Enigma uses its own star-and-orbit identity, separate from host characters.
    // 头像文件在 assets/enigma/ 子目录（不与 yuan 平铺头像混用）。
    enigma: Object.freeze({
      yuan: "enigma",
      symbol: "◈",
      moodLabel: "WORK",
      accent: "#2f6d8f",
      avatar: "enigma/avatar.png",
    }),
  });

export function normalizeYuan(yuan?: string | null): string {
  const key = String(yuan || "")
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(YUAN_VISUALS, key)
    ? key
    : FALLBACK_YUAN;
}

export function getYuanVisual(yuan?: string | null): Readonly<YuanVisual> {
  return YUAN_VISUALS[normalizeYuan(yuan)];
}

/** Asset identity must not depend on whether the current locale translates a
 * persona. Preserve legacy extra personas through their supplied asset. */
export function yuanAvatarAsset(yuan?: string | null, legacyAvatar?: string): string {
  const key=String(yuan||'').trim().toLowerCase();
  return YUAN_VISUALS[key]?.avatar || legacyAvatar || YUAN_VISUALS[FALLBACK_YUAN].avatar;
}

export function moodLabelForYuan(yuan?: string | null): string {
  const visual = getYuanVisual(yuan);
  return `${visual.symbol} ${visual.moodLabel}`;
}
