// Position d'un avion recalculée localement chaque seconde (grand cercle) : mouvement continu comme un « film » en temps réel.
const rad = (x) => (x * Math.PI) / 180, deg = (x) => (x * 180) / Math.PI;
export function interp(a, b, f) {
  const d = Math.acos(Math.min(1, Math.max(-1, Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon)))));
  if (d < 1e-9) return [a.lat, a.lon];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
  const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}
export function cap(p, q) {
  const dl = rad(q[1] - p[1]);
  const y = Math.sin(dl) * Math.cos(rad(q[0]));
  const x = Math.cos(rad(p[0])) * Math.sin(rad(q[0])) - Math.sin(rad(p[0])) * Math.cos(rad(q[0])) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export function etatLocal(v, t) {
  if (!v.position) return null;
  const fixe = { phase: v.phase, f: v.progression, pos: [v.position.lat, v.position.lon], cap: v.cap ?? 0 };
  if (!v.departTs || !v.arriveeTs || v.phase === 'ANNULE' || v.statut === 'ATTERRI') return fixe;
  const dep = Date.parse(v.departTs), arr = Date.parse(v.arriveeTs);
  const f = t < dep ? 0 : t >= arr ? 1 : Math.min(0.97, Math.max(0.03, (t - dep) / (arr - dep)));
  const pos = interp(v.trace[0], v.trace[1], f);
  return { phase: t < dep ? 'AU_SOL' : t >= arr ? 'ARRIVE' : 'EN_VOL', f, pos, cap: cap(pos, interp(v.trace[0], v.trace[1], Math.min(1, f + 0.01))) };
}

// Points du grand cercle entre les fractions f0 et f1 (trajectoire courbe réelle).
export function arc(a, b, f0 = 0, f1 = 1) {
  const n = Math.max(2, Math.ceil(70 * (f1 - f0)) + 1), out = [];
  for (let i = 0; i <= n; i++) out.push(interp(a, b, f0 + ((f1 - f0) * i) / n));
  return out;
}
