// The battlefield (UI-05, D-225): the fight with Death drawn as a place, in the centre of the play screen. The Juice
// Shop in the middle, its seven entrances round it, the vault of souls inside, a barrier as strong as the business
// is healthy, customers coming and going, Death outside, coming closer stage by stage, his shadows running at the
// entrance he is attacking. Everything on it is read from the engine: an entrance is sealed when the engine says a
// fix holds for every attack on it (`anyStopperHolds`), the stolen admin key is the engine's `gains`, the roots are
// its `footholds`, the souls are its count. The effects (a shield, a gate slamming, the key shattering, a root
// breaking, souls pulled out) play only on the engine events or the state changes that mean them.

import { anyStopperHolds, footholds, gains } from '../../engine/facts';
import type { GameEvent } from '../../engine/log';
import type { World } from '../../engine/state';
import { MOVE_BY_ID } from '../../rules/moves';
import type { Foothold, MoveId } from '../../rules/vocabulary';
import { drawDeath } from '../screen3-briefing/cinema/characters';

type G = CanvasRenderingContext2D;

export type GateId = 'front' | 'login' | 'passwords' | 'signup' | 'search' | 'admin' | 'uploads';

export interface GateDef {
  id: GateId;
  label: string;
  moves: MoveId[];
  others: string[]; // minions and taps that come through it
}

/** The seven entrances, and which of Death's attacks come through each (rules/moves.ts). */
export const GATES: readonly GateDef[] = [
  { id: 'front', label: 'Front door', moves: ['ATK-01', 'ATK-02'], others: ['MIN-01', 'MIN-04', 'TAP-01', 'TAP-02', 'TAP-03'] },
  { id: 'login', label: 'Login', moves: ['ATK-03', 'ATK-04'], others: ['MIN-02'] },
  { id: 'passwords', label: 'Passwords', moves: ['ATK-05', 'ATK-12'], others: [] },
  { id: 'signup', label: 'Sign-up', moves: ['ATK-06', 'ATK-11'], others: [] },
  { id: 'search', label: 'Search', moves: ['ATK-08'], others: [] },
  { id: 'admin', label: 'Admin API', moves: ['ATK-07', 'ATK-09', 'ATK-10', 'ATK-14', 'ATK-15', 'ATK-16'], others: ['MIN-03'] },
  { id: 'uploads', label: 'Uploads', moves: ['ATK-13', 'ATK-17'], others: [] },
];

export function gateOf(actor: string): GateDef | undefined {
  return GATES.find((g) => g.moves.includes(actor as MoveId) || g.others.includes(actor));
}

export type GateState = 'quiet' | 'attacked' | 'breached' | 'sealed';

export interface BattleView {
  gates: Record<GateId, GateState>;
  /** Death's stage: how close he has come (0 before his first move). */
  stage: number;
  /** He holds a stolen admin key (an admin session, his own admin account). */
  key: boolean;
  roots: Foothold[];
  souls: number;
  total: number;
  heartbeat: number;
  max: number;
  offline: boolean;
  evidence: number;
  /** His shadows on the way in: the gate each live attack is aimed at. */
  raids: Array<{ gate: GateId; death: boolean }>;
}

/** The battlefield as the engine has it now. */
export function battleOf(world: World): BattleView {
  // a frozen attack (D-45: a fix holds) is held at its gate, not running at it
  const live = world.replays.filter((r) => r.frozenSince === undefined).map((r) => ({ actor: r.move as string, death: r.owner === 'death' }));
  for (const w of world.waves) if (w.endsAt > world.clock.gameMs) live.push({ actor: w.minion, death: false });
  const gates = {} as Record<GateId, GateState>;
  for (const g of GATES) {
    const sealed = g.moves.every((m) => anyStopperHolds(world, MOVE_BY_ID[m]));
    const attacked = live.some((l) => g.moves.includes(l.actor as MoveId) || g.others.includes(l.actor));
    const breached = world.death.played.some((p) => p.outcome === 'landed' && g.moves.includes(p.move));
    gates[g.id] = attacked ? 'attacked' : sealed ? 'sealed' : breached ? 'breached' : 'quiet';
  }
  const started = world.events.filter((e): e is Extract<GameEvent, { kind: 'move-started' }> => e.kind === 'move-started');
  const gained = gains(world);
  return {
    gates,
    stage: Math.max(0, ...started.map((e) => e.stage)),
    key: gained.has('admin-session') || gained.has('own-admin'),
    roots: [...footholds(world)],
    souls: world.souls.total - world.souls.stolen.length,
    total: world.souls.total,
    heartbeat: world.heartbeat,
    max: world.heartbeatMax,
    offline: world.nginx === 'stopped',
    evidence: world.evidence.length,
    raids: live.map((l) => ({ gate: gateOf(l.actor)?.id ?? 'front', death: l.death })).filter((r, i, all) => all.findIndex((x) => x.gate === r.gate && x.death === r.death) === i),
  };
}

// ------------------------------------------------------------------ the effects

export type FxKind = 'shield' | 'seal' | 'breach' | 'souls' | 'key' | 'root' | 'evidence' | 'recover' | 'recoil' | 'lunge' | 'lost';

interface Fx {
  kind: FxKind;
  gate?: GateId;
  start: number;
  n?: number;
}

/**
 * How much an engine event moves Death's menace (0 far and weak, 1 at the barrier): his successes bring him closer,
 * the player's cuts and fixes push him back (D-226). Nothing else moves it.
 */
export function menaceStep(e: GameEvent): number {
  switch (e.kind) {
    case 'move-started':
      return 0.04;
    case 'move-landed':
      return 0.16;
    case 'souls-stolen':
      return Math.min(0.08, 0.01 * e.count);
    case 'return':
      return 0.5;
    case 'customer-lost':
      return 0.02;
    case 'move-cut':
      return -0.12;
    case 'door-shut':
      return -0.15;
    case 'patch-applied':
      return -0.06;
    case 'tap-closed':
      return e.by ? -0.04 : 0;
    case 'banished':
      return -1;
    default:
      return 0;
  }
}

/** Which effect an engine event plays on the battlefield, and where. */
export function fxOf(e: GameEvent): Array<{ kind: FxKind; gate?: GateId; n?: number }> {
  switch (e.kind) {
    case 'move-cut':
      return [{ kind: 'shield', gate: gateOf(e.move)?.id }, { kind: 'recoil' }];
    case 'wave-ended':
      return e.closedBy ? [{ kind: 'shield', gate: gateOf(e.minion)?.id }] : [];
    case 'tap-closed':
      return e.by ? [{ kind: 'shield', gate: 'front' }] : [];
    case 'door-shut':
      return [{ kind: 'seal', gate: gateOf(e.move)?.id }, { kind: 'recoil' }];
    case 'patch-applied':
      return [{ kind: 'recover' }];
    case 'move-landed':
      return [{ kind: 'breach', gate: gateOf(e.move)?.id }, { kind: 'lunge' }];
    case 'souls-stolen':
      return [{ kind: 'souls', n: e.count }];
    case 'customer-lost':
      return [{ kind: 'lost' }];
    case 'return':
      return [{ kind: 'lunge' }];
    case 'action':
      if (!e.ok) return [];
      if (e.action.type === 'DEF-05') return [{ kind: 'evidence' }];
      if (e.action.type === 'DEF-17' || e.action.type === 'DEF-18') return [{ kind: 'recover' }];
      return [];
    default:
      return [];
  }
}

const rand = (i: number): number => {
  const x = Math.sin(i * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));

/** The battlefield's moving parts: the effects in flight and what changed since the last frame. */
export class Battle {
  private fx: Fx[] = [];
  private seen = 0;
  private lastKey = false;
  private lastRoots = new Set<Foothold>();
  private lastGates: Partial<Record<GateId, GateState>> = {};
  private lastFrozen = new Set<number>();
  private started = false;
  /** Death's menace from the engine's events, and the value drawn (eased toward it). */
  menace = 0.15;
  private shown = 0.15;
  private lastT = 0;
  private endedAt = -1;

  /** Read the world: new events become effects, and state changes (the key gone, a root removed) do too. */
  update(world: World, t: number): BattleView {
    const v = battleOf(world);
    const evs = world.events;
    if (!this.started) {
      this.seen = evs.length;
      this.started = true;
    }
    for (let i = this.seen; i < evs.length; i++) {
      for (const f of fxOf(evs[i]!)) this.fx.push({ ...f, start: t });
      this.menace = clamp(this.menace + menaceStep(evs[i]!));
    }
    this.seen = evs.length;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.shown += (this.menace - this.shown) * (1 - Math.exp(-dt * 1.6));
    if (world.ending && this.endedAt < 0) this.endedAt = t;
    if (this.lastKey && !v.key) this.fx.push({ kind: 'key', start: t });
    for (const r of this.lastRoots) if (!v.roots.includes(r)) this.fx.push({ kind: 'root', start: t, n: ROOTS.indexOf(r) });
    for (const g of GATES) if (this.lastGates[g.id] && this.lastGates[g.id] !== 'sealed' && v.gates[g.id] === 'sealed') this.fx.push({ kind: 'seal', gate: g.id, start: t });
    // an attack the engine has just frozen: a shield at its gate, and he recoils
    const frozen = new Set(world.replays.filter((r) => r.frozenSince !== undefined).map((r) => r.id));
    for (const r of world.replays) {
      if (r.frozenSince !== undefined && !this.lastFrozen.has(r.id)) {
        this.fx.push({ kind: 'shield', gate: gateOf(r.move)?.id, start: t }, { kind: 'recoil', start: t });
        if (r.owner === 'death') this.menace = clamp(this.menace - 0.08);
      }
    }
    this.lastFrozen = frozen;
    this.lastKey = v.key;
    this.lastRoots = new Set(v.roots);
    this.lastGates = { ...v.gates };
    this.fx = this.fx.filter((f) => t - f.start < 3.5);
    return v;
  }

  /** The effects started in the last `s` seconds (for the sounds). */
  fresh(t: number, s: number): FxKind[] {
    return this.fx.filter((f) => t - f.start < s).map((f) => f.kind);
  }

  paint(g: G, w: number, h: number, dpr: number, t: number, v: BattleView, focus: GateId | null, ending: { kind: string; through?: Foothold } | null = null): void {
    paintBattle(g, w, h, dpr, t, v, this.fx, focus, this.shown, ending && this.endedAt >= 0 ? { ...ending, e: t - this.endedAt } : null);
  }
}

const ROOTS: Foothold[] = ['hidden-admin', 'hijacked-user', 'planted-file', 'forged-token'];
export const ROOT_WORDS: Record<Foothold, string> = { 'hidden-admin': 'a hidden admin', 'hijacked-user': 'a stolen customer account', 'planted-file': 'a planted file', 'forged-token': 'a forged pass' };

// ------------------------------------------------------------------ the painter

/** Where things stand on the battlefield, in fractions of its width and height. */
function layout(w: number, h: number) {
  const shop = { x: w * 0.42, y: h * 0.5 };
  const R = Math.min(w * 0.26, h * 0.4);
  const gates = new Map<GateId, { x: number; y: number; a: number }>();
  GATES.forEach((gd, i) => {
    const a = -Math.PI * 0.42 + (i / (GATES.length - 1)) * Math.PI * 0.84; // an arc facing Death, on the right
    gates.set(gd.id, { x: shop.x + Math.cos(a) * R, y: shop.y + Math.sin(a) * R * 0.66, a });
  });
  return { shop, R, gates };
}

function deathAt(w: number, h: number, menace: number) {
  return { x: w * (0.95 - 0.3 * clamp(menace)), y: h * 0.62 };
}

function glow(g: G, x: number, y: number, r: number, c: string): void {
  if (r <= 0.5) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, c);
  gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const ease = (u: number) => {
  const x = clamp(u);
  return x * x * (3 - 2 * x);
};

interface EndingView {
  kind: string;
  through?: Foothold;
  /** Seconds since the ending. */
  e: number;
}

function paintBattle(g: G, w: number, h: number, dpr: number, t: number, v: BattleView, fx: Fx[], focus: GateId | null, menace: number, ending: EndingView | null): void {
  const L = layout(w, h);
  const health = clamp(v.heartbeat / 100);
  // the ground: night fog, a grid of streets fading out
  const bg = g.createRadialGradient(L.shop.x, L.shop.y, h * 0.05, L.shop.x, L.shop.y, w * 0.8);
  bg.addColorStop(0, v.offline ? '#0a0608' : '#0c1620');
  bg.addColorStop(1, '#030507');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(70, 232, 255, 0.05)';
  g.lineWidth = 1;
  for (let x = (t * 4) % 40; x < w; x += 40) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  // crimson fog creeping in from Death's side, thicker each stage
  const fog = g.createLinearGradient(w, 0, w * 0.3, 0);
  fog.addColorStop(0, `rgba(120, 0, 20, ${(0.12 + 0.06 * v.stage).toFixed(3)})`);
  fog.addColorStop(1, 'rgba(120, 0, 20, 0)');
  g.fillStyle = fog;
  g.fillRect(0, 0, w, h);

  // the customers, coming and going through the front, as many as the business is healthy
  const front = L.gates.get('front')!;
  const customers = v.offline ? 0 : Math.round(3 + 9 * clamp(v.heartbeat / 100));
  for (let i = 0; i < customers; i++) {
    const u = (t * (0.05 + rand(i) * 0.05) + rand(i + 9)) % 1;
    const x = front.x + (L.shop.x - front.x) * u + Math.sin(i * 3 + t) * 8;
    const y = front.y + (L.shop.y - front.y) * u - h * 0.06 + rand(i + 4) * h * 0.12;
    g.fillStyle = 'rgba(200, 230, 255, 0.4)';
    g.beginPath();
    g.arc(x, y - 7, 3, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 2.5, y - 4, 5, 9);
  }

  // the barrier: a dome as strong as the business is healthy; cracked and flickering when weak
  const dome = L.R * 1.12;
  g.save();
  g.strokeStyle = `rgba(70, 232, 255, ${(0.12 + 0.4 * health).toFixed(3)})`;
  g.lineWidth = 2 + 3 * health;
  g.setLineDash(health < 0.35 ? [10, 8 + (1 - health) * 30] : []);
  if (health < 0.35 && Math.sin(t * 17) > 0.6) g.globalAlpha = 0.4;
  g.beginPath();
  g.ellipse(L.shop.x, L.shop.y, dome, dome * 0.8, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  glow(g, L.shop.x, L.shop.y, dome, `rgba(70, 232, 255, ${(0.05 * health).toFixed(3)})`);

  // the shop: a dark hall with a lit sign; the vault of souls inside
  shopHall(g, L.shop.x, L.shop.y, h * 0.2, v.offline, t);
  vault(g, L.shop.x, L.shop.y + h * 0.02, h * 0.07, v.souls, v.total, t);

  // the roots of his footholds, crimson, from the shop's foundations outward
  v.roots.forEach((r) => root(g, L.shop.x, L.shop.y, h, ROOTS.indexOf(r), t, 1));

  // the entrances
  for (const gd of GATES) {
    const p = L.gates.get(gd.id)!;
    gate(g, p.x, p.y, h * 0.05, v.gates[gd.id], gd.label, t, focus === gd.id);
  }

  // Death: as close and as large as his menace, darker and more broken-in each stage; recoiling on a cut, lunging on
  // a landing. His crimson aura grows with the menace; his eyes burn brighter.
  const d = deathAt(w, h, menace);
  const recoil = fx.filter((f) => f.kind === 'recoil').map((f) => t - f.start).find((e) => e < 1);
  const lunge = fx.filter((f) => f.kind === 'lunge').map((f) => t - f.start).find((e) => e < 1);
  const dx = recoil !== undefined ? Math.sin(recoil * Math.PI) * w * 0.05 : lunge !== undefined ? -Math.sin(lunge * Math.PI) * w * 0.06 : 0;
  const end = ending ? endingDeath(ending, d, w, h, L) : null;
  if ((v.stage > 0 || v.raids.length > 0 || end) && (end?.form ?? 1) > 0.01) {
    const size = h * (0.34 + 0.3 * menace + 0.02 * v.stage) * (end?.scale ?? 1);
    const at = end ? { x: end.x, y: end.y } : { x: d.x + dx, y: d.y };
    glow(g, at.x, at.y - size * 0.5, size * (0.7 + 0.5 * menace), `rgba(150, 0, 20, ${(0.12 + 0.3 * menace).toFixed(3)})`);
    // ink dripping from him once he has taken something (stage 4 on)
    if (v.stage >= 4) {
      for (let i = 0; i < 10; i++) {
        const u = (t * 0.3 + rand(i)) % 1;
        g.fillStyle = `rgba(10, 0, 4, ${(0.7 * (1 - u)).toFixed(3)})`;
        g.beginPath();
        g.ellipse(at.x + (rand(i + 3) - 0.5) * size * 0.6, at.y - size * 0.1 + u * size * 0.25, 2 + 3 * rand(i), 4 + 8 * u, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.save();
    g.globalAlpha = 0.92 * (end?.form ?? 1);
    drawDeath(g, at.x, at.y + size * 0.72, size, { t, form: end?.form ?? 1, point: lunge !== undefined || (end?.point ?? 0) > 0.5 ? 1 : 0, fragment: end?.fragment ?? (recoil !== undefined ? 0.3 : 0), eyes: 0.4 + 0.6 * menace }, dpr);
    g.restore();
    if (v.key && !end) key(g, at.x - size * 0.18, at.y - size * 0.2, h * 0.05, t, 1);
  }
  for (const raid of v.raids) {
    const p = L.gates.get(raid.gate)!;
    for (let i = 0; i < (raid.death ? 5 : 3); i++) {
      const u = (t * 0.35 + i / 5) % 1;
      const x = d.x + (p.x - d.x) * u;
      const y = d.y + (p.y - d.y) * u + Math.sin(u * 9 + i) * h * 0.02;
      shadow(g, x, y, h * (raid.death ? 0.035 : 0.022), raid.death, u);
    }
  }

  // the effects
  for (const f of fx) {
    const e = t - f.start;
    const p = f.gate ? L.gates.get(f.gate) : undefined;
    switch (f.kind) {
      case 'shield':
        if (p) shieldFx(g, p.x, p.y, h * 0.09, e);
        break;
      case 'seal':
        if (p) sealFx(g, p.x, p.y, h * 0.06, e);
        break;
      case 'breach':
        if (p) breachFx(g, p.x, p.y, h * 0.07, e);
        break;
      case 'souls':
        soulsFx(g, L.shop.x, L.shop.y, d.x, d.y - h * 0.1, e, f.n ?? 3);
        break;
      case 'key':
        shatterFx(g, d.x - h * 0.07, d.y - h * 0.08, h * 0.06, e);
        break;
      case 'root':
        root(g, L.shop.x, L.shop.y, h, f.n ?? 0, t, 1 - ease(e / 1.5));
        shatterFx(g, L.shop.x + Math.cos((f.n ?? 0) * 1.6 + 2.2) * h * 0.18, L.shop.y + h * 0.12, h * 0.04, e);
        break;
      case 'evidence':
        glow(g, w * 0.08, h * 0.78, h * 0.2 * (1 - clamp(e / 2.5)), 'rgba(255, 210, 120, 0.6)');
        break;
      case 'recover':
        glow(g, L.shop.x, L.shop.y, L.R * 1.4 * ease(e / 1.2), `rgba(61, 220, 151, ${(0.35 * (1 - clamp(e / 2.5))).toFixed(3)})`);
        break;
      case 'lost':
        glow(g, front.x, front.y, h * 0.08, `rgba(255, 60, 80, ${(0.4 * (1 - clamp(e / 1.5))).toFixed(3)})`);
        break;
      default:
        break;
    }
  }
  // the evidence board, lit once evidence is preserved
  if (v.evidence > 0) {
    g.fillStyle = 'rgba(255, 210, 120, 0.12)';
    g.strokeStyle = 'rgba(255, 210, 120, 0.6)';
    g.lineWidth = 1.5;
    g.fillRect(w * 0.03, h * 0.68, w * 0.1, h * 0.2);
    g.strokeRect(w * 0.03, h * 0.68, w * 0.1, h * 0.2);
    g.fillStyle = 'rgba(255, 220, 150, 0.85)';
    g.font = `${Math.max(10, h * 0.025)}px "Share Tech Mono", monospace`;
    g.textAlign = 'center';
    g.fillText(`EVIDENCE ×${v.evidence}`, w * 0.08, h * 0.91);
  }
  if (ending) paintEnding(g, w, h, t, v, ending, L, end ? { x: end.x, y: end.y } : d);
  // the vignette
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
}

function shopHall(g: G, x: number, y: number, s: number, offline: boolean, t: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#0b0d12';
  g.strokeStyle = offline ? 'rgba(255, 60, 80, 0.5)' : 'rgba(70, 232, 255, 0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-s * 0.7, s * 0.35);
  g.lineTo(-s * 0.7, -s * 0.2);
  g.lineTo(-s * 0.45, -s * 0.45);
  g.lineTo(0, -s * 0.7);
  g.lineTo(s * 0.45, -s * 0.45);
  g.lineTo(s * 0.7, -s * 0.2);
  g.lineTo(s * 0.7, s * 0.35);
  g.closePath();
  g.fill();
  g.stroke();
  // windows, lit while the shop is up
  for (let i = 0; i < 5; i++) {
    const on = !offline && Math.sin(t * 0.7 + i * 2) > -0.6;
    g.fillStyle = on ? 'rgba(255, 196, 120, 0.7)' : 'rgba(40, 40, 50, 0.6)';
    g.fillRect(-s * 0.55 + i * s * 0.25, -s * 0.15, s * 0.1, s * 0.12);
  }
  g.fillStyle = offline ? 'rgba(255, 60, 80, 0.85)' : 'rgba(255, 178, 62, 0.9)';
  g.font = `700 ${Math.max(9, s * 0.13)}px Cinzel, serif`;
  g.textAlign = 'center';
  g.fillText(offline ? 'CLOSED' : 'JUICE SHOP', 0, -s * 0.28);
  g.restore();
}

function vault(g: G, x: number, y: number, s: number, souls: number, total: number, t: number): void {
  const n = Math.max(0, Math.round((souls / Math.max(1, total)) * 24));
  for (let i = 0; i < n; i++) {
    const a = rand(i) * Math.PI * 2 + t * 0.3;
    const r = s * Math.sqrt(rand(i + 3));
    glow(g, x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 0.6, s * 0.22, 'rgba(190, 230, 255, 0.55)');
  }
  g.fillStyle = 'rgba(220, 240, 255, 0.9)';
  g.font = `${Math.max(10, s * 0.3)}px "Share Tech Mono", monospace`;
  g.textAlign = 'center';
  g.fillText(`${souls} souls`, x, y + s * 1.2);
}

function gate(g: G, x: number, y: number, s: number, state: GateState, label: string, t: number, focus: boolean): void {
  const colour = state === 'sealed' ? [70, 232, 255] : state === 'attacked' ? [255, 42, 74] : state === 'breached' ? [255, 120, 60] : [120, 140, 160];
  const pulse = state === 'attacked' ? 0.6 + 0.4 * Math.sin(t * 8) : 1;
  const [r, gg, b] = colour;
  if (focus || state === 'attacked') glow(g, x, y, s * 2.2, `rgba(${r}, ${gg}, ${b}, ${(0.25 * pulse).toFixed(3)})`);
  g.save();
  g.translate(x, y);
  // the arch
  g.strokeStyle = `rgba(${r}, ${gg}, ${b}, ${(0.85 * pulse).toFixed(3)})`;
  g.lineWidth = focus ? 3.5 : 2.5;
  g.beginPath();
  g.moveTo(-s * 0.6, s * 0.6);
  g.lineTo(-s * 0.6, -s * 0.2);
  g.quadraticCurveTo(-s * 0.6, -s * 0.8, 0, -s * 0.9);
  g.quadraticCurveTo(s * 0.6, -s * 0.8, s * 0.6, -s * 0.2);
  g.lineTo(s * 0.6, s * 0.6);
  g.stroke();
  if (state === 'sealed') {
    // bars across, and a lock
    g.fillStyle = `rgba(${r}, ${gg}, ${b}, 0.25)`;
    g.fillRect(-s * 0.55, -s * 0.5, s * 1.1, s * 1.1);
    g.strokeStyle = `rgba(${r}, ${gg}, ${b}, 0.9)`;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * s * 0.22, -s * 0.6);
      g.lineTo(i * s * 0.22, s * 0.6);
      g.stroke();
    }
  } else if (state === 'breached' || state === 'attacked') {
    // cracks
    g.strokeStyle = `rgba(255, 90, 90, ${(0.7 * pulse).toFixed(3)})`;
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, -s * 0.2);
      let px = 0;
      let py = -s * 0.2;
      for (let j = 0; j < 3; j++) {
        px += (rand(i * 7 + j) - 0.5) * s * 0.5;
        py += (rand(i * 3 + j + 1) - 0.3) * s * 0.4;
        g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  g.fillStyle = `rgba(${r}, ${gg}, ${b}, 0.95)`;
  g.font = `${Math.max(10, s * 0.32)}px "Share Tech Mono", monospace`;
  g.textAlign = 'center';
  g.fillText(label.toUpperCase(), 0, s * 1.45);
  g.restore();
}

function shadow(g: G, x: number, y: number, s: number, his: boolean, u: number): void {
  g.save();
  g.globalAlpha = Math.sin(u * Math.PI) * (his ? 0.95 : 0.7);
  g.fillStyle = his ? '#050306' : '#1a0a12';
  g.beginPath();
  g.ellipse(x, y - s * 0.6, s * 0.35, s * 0.45, 0, 0, Math.PI * 2);
  g.moveTo(x - s * 0.4, y - s * 0.3);
  g.quadraticCurveTo(x, y + s * 0.8, x + s * 0.4, y - s * 0.3);
  g.fill();
  g.fillStyle = 'rgba(255, 40, 60, 0.9)';
  g.fillRect(x - s * 0.15, y - s * 0.68, s * 0.08, s * 0.05);
  g.fillRect(x + s * 0.07, y - s * 0.68, s * 0.08, s * 0.05);
  g.restore();
}

function key(g: G, x: number, y: number, s: number, t: number, a: number): void {
  glow(g, x, y, s * 1.6, `rgba(255, 200, 80, ${(0.4 * a * (0.7 + 0.3 * Math.sin(t * 4))).toFixed(3)})`);
  g.save();
  g.translate(x, y);
  g.rotate(-0.6);
  g.strokeStyle = `rgba(255, 210, 110, ${a.toFixed(3)})`;
  g.lineWidth = s * 0.15;
  g.beginPath();
  g.arc(0, -s * 0.4, s * 0.3, 0, Math.PI * 2);
  g.moveTo(0, -s * 0.1);
  g.lineTo(0, s * 0.8);
  g.moveTo(0, s * 0.55);
  g.lineTo(s * 0.25, s * 0.55);
  g.moveTo(0, s * 0.75);
  g.lineTo(s * 0.2, s * 0.75);
  g.stroke();
  g.restore();
}

function root(g: G, x: number, y: number, h: number, i: number, t: number, a: number): void {
  if (a <= 0.01) return;
  g.save();
  g.strokeStyle = `rgba(200, 20, 40, ${(0.75 * a).toFixed(3)})`;
  g.shadowColor = 'rgba(255, 30, 50, 0.8)';
  g.shadowBlur = 8;
  const ang = i * 1.6 + 2.2;
  for (let k = 0; k < 3; k++) {
    g.lineWidth = 3 - k;
    g.beginPath();
    let px = x;
    let py = y + h * 0.08;
    g.moveTo(px, py);
    for (let j = 0; j < 6; j++) {
      px += Math.cos(ang + (rand(i * 11 + j + k) - 0.5) * 1.2) * h * 0.05;
      py += Math.abs(Math.sin(ang + j * 0.3)) * h * 0.03 + Math.sin(t + j + k) * 1.5;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

function shieldFx(g: G, x: number, y: number, s: number, e: number): void {
  if (e > 2) return;
  const u = ease(e / 0.6);
  const fade = 1 - clamp((e - 1) / 1);
  g.save();
  g.strokeStyle = `rgba(120, 240, 255, ${(0.9 * fade).toFixed(3)})`;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(x, y, s * u, Math.PI * 0.9, Math.PI * 2.1);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.9 + (i / 5) * Math.PI * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * s * u, y + Math.sin(a) * s * u);
    g.stroke();
  }
  g.restore();
  glow(g, x, y, s * 1.5 * u, `rgba(70, 232, 255, ${(0.35 * fade).toFixed(3)})`);
}

function sealFx(g: G, x: number, y: number, s: number, e: number): void {
  if (e > 1.5) return;
  const drop = ease(e / 0.35);
  g.save();
  g.fillStyle = `rgba(160, 245, 255, ${(0.8 * (1 - clamp((e - 0.6) / 0.9))).toFixed(3)})`;
  g.fillRect(x - s * 0.6, y - s * 0.9, s * 1.2, s * 1.5 * drop);
  g.restore();
}

function breachFx(g: G, x: number, y: number, s: number, e: number): void {
  if (e > 1.6) return;
  glow(g, x, y, s * 2 * ease(e / 0.3), `rgba(255, 30, 50, ${(0.6 * (1 - clamp(e / 1.6))).toFixed(3)})`);
}

function soulsFx(g: G, x0: number, y0: number, x1: number, y1: number, e: number, n: number): void {
  if (e > 2.8) return;
  for (let i = 0; i < Math.min(12, n + 3); i++) {
    const u = clamp((e - i * 0.12) / 1.8);
    if (u <= 0 || u >= 1) continue;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 60;
    glow(g, x, y, 12, `rgba(200, 235, 255, ${(0.8 * Math.sin(u * Math.PI)).toFixed(3)})`);
  }
}

function shatterFx(g: G, x: number, y: number, s: number, e: number): void {
  if (e > 1.4) return;
  const u = ease(e / 1.2);
  g.save();
  g.fillStyle = `rgba(255, 220, 140, ${(1 - u).toFixed(3)})`;
  for (let i = 0; i < 12; i++) {
    const a = rand(i) * Math.PI * 2;
    const r = s * 2 * u * (0.5 + rand(i + 5));
    g.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 3, 3);
  }
  g.restore();
}

// ------------------------------------------------------------------ the endings, on the battlefield (D-226)

type Layout = ReturnType<typeof layout>;

/** Where Death is, and how much of him, during each ending. */
function endingDeath(en: EndingView, d: { x: number; y: number }, w: number, h: number, L: Layout): { x: number; y: number; scale: number; form: number; fragment: number; point: number } {
  const e = en.e;
  switch (en.kind) {
    case 'banished':
      // he comes apart and is gone
      return { x: d.x, y: d.y, scale: 1, form: clamp(1 - e / 4), fragment: clamp(0.1 + e / 3), point: 0 };
    case 'return': {
      // it looks like the banishment... then he rises from inside the shop, through the way back he kept
      if (e < 2.8) return { x: d.x, y: d.y, scale: 1, form: clamp(1 - e / 2.8) * 0.85 + 0.15, fragment: clamp(0.1 + e / 2.2), point: 0 };
      const u = ease((e - 3) / 2.5);
      return { x: L.shop.x, y: L.shop.y + h * 0.1 - u * h * 0.08, scale: 0.6 + 1.3 * u, form: clamp((e - 2.9) / 0.8), fragment: 0.05, point: e > 5 ? 1 : 0 };
    }
    case 'souls-lost':
    case 'flatline': {
      // he walks up to the barrier and leans over the shop
      const u = ease(e / 3.5);
      return { x: d.x + (L.shop.x + L.R * 1.15 - d.x) * u, y: d.y, scale: 1 + 0.45 * u, form: 1, fragment: 0.05, point: e > 3 ? 1 : 0 };
    }
    case 'clean-handover':
      return { x: d.x + w * 0.35 * ease(e / 4), y: d.y, scale: 1, form: clamp(1 - e / 4), fragment: 0.2, point: 0 };
    default:
      // a rough handover, or he walked the halls: he steps back into the fog, still watching
      return { x: d.x + w * 0.12 * ease(e / 4), y: d.y, scale: 0.9, form: 1 - 0.5 * ease(e / 4), fragment: 0.1, point: 0 };
  }
}

/** The ending's scene over the battlefield: light, darkness, the heart line, the souls, the twist. */
function paintEnding(g: G, w: number, h: number, t: number, v: BattleView, en: EndingView, L: Layout, death: { x: number; y: number }): void {
  const e = en.e;
  const dawn = (a: number) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, `rgba(255, 190, 150, ${(0.28 * a).toFixed(3)})`);
    gr.addColorStop(0.5, `rgba(140, 170, 220, ${(0.18 * a).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(40, 60, 110, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  switch (en.kind) {
    case 'banished': {
      // every gate flashes shut in turn, and the light comes up from the shop
      GATES.forEach((gd, i) => {
        const p = L.gates.get(gd.id)!;
        sealFx(g, p.x, p.y, h * 0.06, e - 0.3 - i * 0.22);
      });
      glow(g, L.shop.x, L.shop.y, L.R * 2.2 * ease((e - 1.5) / 3), `rgba(190, 240, 255, ${(0.35 * clamp((e - 1.5) / 3)).toFixed(3)})`);
      dawn(clamp((e - 3) / 3));
      break;
    }
    case 'return': {
      if (e < 2.8) {
        glow(g, L.shop.x, L.shop.y, L.R * 1.8 * ease(e / 2.5), `rgba(190, 240, 255, ${(0.3 * clamp(e / 2.5)).toFixed(3)})`);
        break;
      }
      // the way back he kept: its root splits the floor of the shop, crimson; the light dies from inside out
      const k = ROOTS.indexOf(en.through ?? 'hidden-admin');
      root(g, L.shop.x, L.shop.y, h, k < 0 ? 0 : k, t, 1);
      const crack = clamp((e - 2.8) / 0.4);
      g.strokeStyle = `rgba(255, 40, 60, ${(0.9 * crack).toFixed(3)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(L.shop.x - h * 0.08 * crack, L.shop.y + h * 0.1);
      g.lineTo(L.shop.x, L.shop.y - h * 0.02);
      g.lineTo(L.shop.x + h * 0.06 * crack, L.shop.y + h * 0.12);
      g.stroke();
      if (e < 3.3) {
        g.fillStyle = `rgba(255, 20, 40, ${(0.35 * (1 - (e - 2.8) / 0.5)).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      }
      const dark = clamp((e - 3.2) / 3);
      const rg = g.createRadialGradient(L.shop.x, L.shop.y, h * 0.05, L.shop.x, L.shop.y, w * 0.9 * dark + 1);
      rg.addColorStop(0, `rgba(30, 0, 6, ${(0.55 * dark).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
      if (e > 4) {
        g.fillStyle = `rgba(255, 190, 196, ${clamp((e - 4) / 0.8).toFixed(3)})`;
        g.font = `${Math.max(12, h * 0.03)}px "Share Tech Mono", monospace`;
        g.textAlign = 'center';
        g.fillText(`THE WAY BACK YOU MISSED: ${ROOT_WORDS[en.through ?? 'hidden-admin'].toUpperCase()}`, w / 2, h * 0.1);
      }
      break;
    }
    case 'souls-lost': {
      // what was left of the souls streams out to him; the vault goes dark
      for (let i = 0; i < 18; i++) {
        const u = clamp((e - i * 0.18) / 2.2);
        if (u <= 0 || u >= 1) continue;
        const x = L.shop.x + (death.x - L.shop.x) * u;
        const y = L.shop.y + (death.y - h * 0.15 - L.shop.y) * u - Math.sin(u * Math.PI) * h * 0.1;
        glow(g, x, y, h * 0.02, `rgba(200, 235, 255, ${(0.8 * Math.sin(u * Math.PI)).toFixed(3)})`);
      }
      g.fillStyle = `rgba(60, 0, 10, ${(0.4 * clamp(e / 5)).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
      break;
    }
    case 'flatline': {
      // the heart line across the field, beating, then flat
      const y0 = h * 0.86;
      const len = clamp(e / 4) * w;
      g.strokeStyle = e < 2.4 ? 'rgba(61, 220, 151, 0.9)' : 'rgba(200, 60, 70, 0.9)';
      g.lineWidth = 2.5;
      g.shadowColor = g.strokeStyle;
      g.shadowBlur = 10;
      g.beginPath();
      g.moveTo(0, y0);
      for (let x = 0; x < len; x += 4) {
        const beat = x < w * 0.45 ? Math.max(0, Math.sin((x / w) * 40)) ** 12 : 0;
        g.lineTo(x, y0 - beat * h * 0.08);
      }
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = `rgba(0, 0, 0, ${(0.45 * clamp((e - 2) / 4)).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
      break;
    }
    case 'clean-handover':
      dawn(clamp(e / 4));
      break;
    default:
      dawn(clamp(e / 4) * 0.5);
      // his eyes, still there in the fog
      if (e > 2) {
        glow(g, w * 0.93, h * 0.42, h * 0.02, `rgba(255, 40, 60, ${(0.8 * (0.6 + 0.4 * Math.sin(t * 3))).toFixed(3)})`);
        glow(g, w * 0.95, h * 0.42, h * 0.02, `rgba(255, 40, 60, ${(0.8 * (0.6 + 0.4 * Math.sin(t * 3))).toFixed(3)})`);
      }
  }
  void v;
}
