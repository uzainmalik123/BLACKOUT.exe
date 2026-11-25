// The Identity Archive (D-222): an underground archive round a circular table under a projector's beam. A dossier
// floats for each account: a sigil drawn from its initials, the email, its role, a verified seal. Switch between the
// eight admins and the five other special roles; choose a dossier to read it whole. "Show an example intruder"
// brings in an unnamed, clearly illustrative admin that glitches and is stamped UNAUTHORIZED, and Death's
// reflection crosses the table. A shadow passes behind the records now and then. The customers and the known
// weaknesses sit on the table as notes.

import { useEffect, useRef, useState } from 'react';
import { drawDeath } from '../cinema/characters';
import { KiroGuide } from './KiroGuide';
import { ADMINS, ARCHIVE, PLACES, SPECIAL, type Dossier } from './sceneData';

/** A sigil unique to an account: rings and a star drawn from its seed, its initials in the middle. */
function Sigil({ d, size = 54 }: { d: Dossier; size?: number }) {
  const n = 3 + (d.seed % 5);
  const rot = (d.seed >>> 3) % 360;
  const r = size / 2 - 3;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = ((i / n) * 360 + rot) * (Math.PI / 180);
    return `${size / 2 + Math.cos(a) * r * 0.78},${size / 2 + Math.sin(a) * r * 0.78}`;
  }).join(' ');
  const tone = d.kind === 'admin' ? 'var(--emerald)' : 'var(--amber)';
  return (
    <svg className="ia-sigil" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="1.5" />
      <circle cx={size / 2} cy={size / 2} r={r * 0.9} fill="none" stroke={tone} strokeWidth="0.6" strokeDasharray="2 3" />
      <polygon points={pts} fill="none" stroke={tone} strokeWidth="1" opacity="0.8" />
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="#f3eee2" fontSize={size * 0.3} fontWeight="700" fontFamily="Cinzel, Georgia, serif">
        {d.initials}
      </text>
    </svg>
  );
}

const REMARK = {
  admins: 'This is the whole list as of tonight. Eight names. Learn them.',
  special: 'Special, not admin. Still worth knowing by heart.',
  open: (d: Dossier) => (d.kind === 'admin' ? `${d.role}. On the list, so they belong.` : `${d.role}. A special role, on the list.`),
  intruder: "Nobody created this one. If you ever see it for real, he's already inside.",
};

export function IdentityArchive() {
  const [tab, setTab] = useState<'admins' | 'special'>('admins');
  const [open, setOpen] = useState<Dossier | null>(null);
  const [intruder, setIntruder] = useState(false);
  const reflect = useRef<HTMLCanvasElement>(null);
  const list = tab === 'admins' ? ADMINS : SPECIAL;

  // Death's reflection crossing the table while the intruder is shown
  useEffect(() => {
    const c = reflect.current;
    const g = c?.getContext('2d');
    if (!c || !g || !intruder) return;
    const W = 360;
    const H = 220;
    c.width = W;
    c.height = H;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, W, H);
      const pass = Math.min(1, t / 3.2);
      g.save();
      // upside down, as a reflection in the table's dark wood
      g.translate(0, H);
      g.scale(1, -1);
      drawDeath(g, W * (0.15 + 0.7 * pass), H * 1.25, H * 1.2, { t, form: Math.sin(pass * Math.PI) * 0.9, point: 0, fragment: 0.4, eyes: 1 }, 1);
      g.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [intruder]);

  const remark = intruder ? REMARK.intruder : open ? REMARK.open(open) : tab === 'admins' ? REMARK.admins : REMARK.special;

  return (
    <div className={`fs-scene ia-root${intruder ? ' alarm' : ''}`}>
      <div className="ia-beam" aria-hidden="true" />
      <div className="ia-shadow" aria-hidden="true" />
      <div className="ia-table" aria-hidden="true">
        <canvas ref={reflect} className="ia-reflection" />
      </div>
      <div className="ia-switch" role="tablist" aria-label="Accounts">
        <button type="button" role="tab" aria-selected={tab === 'admins'} className={tab === 'admins' ? 'on' : ''} onClick={() => setTab('admins')}>
          Admins · {ADMINS.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'special'} className={tab === 'special' ? 'on' : ''} onClick={() => setTab('special')}>
          Other special roles · {SPECIAL.length}
        </button>
      </div>
      <ul className={`ia-ring n${list.length}`} key={tab}>
        {list.map((d, i) => (
          <li key={d.email} style={{ ['--i' as string]: i, ['--n' as string]: list.length }}>
            <button type="button" className={`ia-dossier ${d.kind}${open?.email === d.email ? ' open' : ''}`} onClick={() => setOpen((o) => (o?.email === d.email ? null : d))} aria-expanded={open?.email === d.email}>
              <Sigil d={d} />
              <span className="ia-email">{d.email}</span>
              <span className="ia-role">{d.role}</span>
              <span className="ia-seal">{d.kind === 'admin' ? '✓ ADMIN · ON THE LIST' : '✓ SPECIAL ROLE · ON THE LIST'}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className={`ia-open ${open.kind}`} role="note">
          <Sigil d={open} size={84} />
          <div>
            <b>{open.email}</b>
            <span>{open.kind === 'admin' ? 'Admin' : 'Special role'}: {open.role}</span>
            <span>Approved: on the list at the start of your shift.</span>
            <span className="ia-rule">{ARCHIVE.rule}</span>
          </div>
          <button type="button" className="fs-back" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
      {intruder && (
        <div className="ia-intruder" role="note" aria-label="Illustrative example of an unauthorized admin">
          <span className="ia-example">Illustrative example · not a real account</span>
          <div className="ia-face" aria-hidden="true" />
          <b>████████@????</b>
          <span>Role: admin</span>
          <span className="ia-not">✗ Not on the list</span>
          <span className="ia-stamp">UNAUTHORIZED</span>
        </div>
      )}
      <div className="ia-notes">
        <p className="ia-note">
          <b>Everyone else</b> {ARCHIVE.everyoneElse}
        </p>
        {ARCHIVE.weaknesses.map((w) => (
          <p key={w} className="ia-note weak">
            <b>Known weakness</b> {w}
          </p>
        ))}
        <button type="button" className={`ia-demo${intruder ? ' on' : ''}`} onClick={() => setIntruder((x) => !x)} aria-pressed={intruder}>
          {intruder ? 'Hide the example intruder' : 'Show an example intruder'}
        </button>
      </div>
      <KiroGuide line={PLACES.admins.caption} remark={remark} />
    </div>
  );
}
