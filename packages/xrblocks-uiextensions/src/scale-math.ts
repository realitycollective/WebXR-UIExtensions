/**
 * Panel fit math — mirrors the IWSDK adapter's behaviour exactly so the same
 * UIKitML renders at the same world size on both platforms: UIKit units are
 * centimeters; the panel group is uniformly scaled to fit the requested
 * width × height (meters) while preserving aspect ratio.
 */

/**
 * Uniform scale that fits a panel of `naturalWidth × naturalHeight` (UIKit
 * cm units) into `targetWidth × targetHeight` meters. Returns undefined
 * when any input is not yet usable (layout not measured, zero target).
 */
export function fitScale(
  targetWidth: number,
  targetHeight: number,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number | undefined {
  if (
    !(targetWidth > 0) ||
    !(targetHeight > 0) ||
    typeof naturalWidth !== 'number' ||
    typeof naturalHeight !== 'number' ||
    !(naturalWidth > 0) ||
    !(naturalHeight > 0)
  ) {
    return undefined;
  }
  const widthMeters = naturalWidth / 100;
  const heightMeters = naturalHeight / 100;
  return Math.min(targetWidth / widthMeters, targetHeight / heightMeters);
}
