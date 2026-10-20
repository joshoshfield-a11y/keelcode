/** Quality tier detection for the Drift Arena graphics wave.
 *
 * Two tiers, chosen once at boot:
 * - 'desktop' — full lighting (sun shadows), higher draw budgets.
 * - 'mobile'  — no shadow maps, reduced budgets.
 *
 * Detection order:
 * 1. `?quality=desktop|mobile` URL param always wins (lets e2e and the
 *    user force a tier).
 * 2. HeadlessChrome is always 'desktop' — the e2e harness runs headless
 *    and must exercise the full-quality path.
 * 3. 'mobile' only when the device actually looks like a phone/tablet:
 *    a mobile UA, or (coarse pointer AND touch points > 0 AND the
 *    smaller screen dimension < 820).
 * 4. Default 'desktop'. In node (unit tests, no window/navigator) the
 *    tier is 'desktop'.
 */

export type QualityTier = 'desktop' | 'mobile';

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function getQualityTier(): QualityTier {
  // Node / unit tests: no DOM at all → desktop.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'desktop';
  }
  try {
    // 1. Explicit override wins over every heuristic.
    const param = new URLSearchParams(window.location.search).get('quality');
    if (param === 'desktop' || param === 'mobile') return param;

    const ua = navigator.userAgent ?? '';

    // 2. Headless e2e must see the desktop path.
    if (/HeadlessChrome/i.test(ua)) return 'desktop';

    // 3a. Mobile user agent.
    if (MOBILE_UA.test(ua)) return 'mobile';

    // 3b. Touch-first device with a small screen (tablets/phones whose UA
    // does not say so, e.g. iPad requesting the desktop site).
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    const touchPoints = navigator.maxTouchPoints ?? 0;
    const screenW = window.screen?.width ?? window.innerWidth;
    const screenH = window.screen?.height ?? window.innerHeight;
    const minDim = Math.min(screenW, screenH);
    if (coarse && touchPoints > 0 && minDim < 820) return 'mobile';

    return 'desktop';
  } catch {
    return 'desktop';
  }
}

/** The tier for this session, resolved once at module load. */
export const TIER: QualityTier = getQualityTier();
