// Which app is running: the website, the Windows app, or the Android or iOS
// app. Its own file so pages that only count campaign visits (campaign.js on
// the website's search pages) do not load the rest of the game.
export function platform() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua) && window.NativeBridge) return 'android';
  if (/iPhone|iPad/i.test(ua) && window.webkit?.messageHandlers) return 'ios';
  return 'web';
}
