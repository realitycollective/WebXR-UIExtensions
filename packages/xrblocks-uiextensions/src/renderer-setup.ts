/**
 * `configureRendererForUikit` now lives in
 * `@realitycollective/threejs-uiextensions` - it is plain three.js/uikit
 * renderer configuration, nothing XR Blocks specific - re-exported under its
 * original path so existing imports keep working unchanged.
 */
export { configureRendererForUikit, type UikitRenderer } from '@realitycollective/threejs-uiextensions';
