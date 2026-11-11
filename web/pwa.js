// Enregistre le service worker et propose « Installer l'application » quand le navigateur le permet.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
let invite = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); invite = e;
  if (document.getElementById('installer')) return;
  const b = document.createElement('button');
  b.id = 'installer'; b.textContent = '📲 Installer l’application';
  b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:100;padding:14px;border:0;border-radius:12px;background:#1f9d55;color:#fff;font:600 16px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
  b.onclick = async () => { b.remove(); invite.prompt(); invite = null; };
  document.body.appendChild(b);
});
