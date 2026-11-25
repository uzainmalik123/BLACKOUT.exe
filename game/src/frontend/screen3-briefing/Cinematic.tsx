// The cinematic briefing (UI-03, D-189): 60 seconds on one canvas (cinema/shots.ts), told by Kiro's voice
// (narrator.ts; no music, no ambience: D-221), with captions, subtitles, and things on
// screen the player can point at or tab to for their facts. Space pauses; Escape asks (keep watching, skip to the
// end, leave); M mutes. The end card is the title, Start the night shift, Replay, an optional three-question check,
// and the four briefing files.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { TAGLINE } from '../screen1-title/TitleScreen';
import { QUIZ, quizScore } from './cinema/facts';
import { paintShot, type Frame, type Hotspot } from './cinema/shots';
import { LINE_DELAY, SHOTS, TOTAL, advance, lineSeconds, mmss, paceFor, replay, seekTo, shotIndex, skipToEnd, spokenLength, startPlayback, togglePlay, type Playback } from './cinema/timeline';
import { BriefingFiles } from './DocPanel';
import { LogoCanvas } from './LogoCanvas';
import { Narrator, wordStart } from './narrator';
import { isMasterMuted, onMasterMute, setMasterMuted } from '../shared/audio';
import './Cinematic.css';

const CAN_SPEAK = Narrator.supported();
/** The player's sound settings, kept while the page is open. */
const prefs = { voice: 1, subtitles: true };

/** The character index of the `n`th word of a line. */
function wordIndex(line: string, n: number): number {
  let i = 0;
  for (let w = 0; w < n; w++) {
    const next = line.indexOf(' ', i);
    if (next < 0) return line.length;
    i = next + 1;
  }
  return i;
}

export interface CinematicProps {
  title: string;
  /** Left by Escape: with how many shots seen and quiz answers right. */
  onClose: (seen: number, right: number) => void;
  /** Start the night shift from the end card. */
  onStart: (seen: number, right: number) => void;
}

interface Ui {
  t: number;
  shot: number;
  playing: boolean;
  ended: boolean;
  seen: number;
}

const uiOf = (p: Playback): Ui => ({ t: p.t, shot: shotIndex(p.t), playing: p.playing, ended: p.ended, seen: p.seen });

export function Cinematic({ title, onClose, onStart }: CinematicProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const play = useRef<Playback>(startPlayback());
  const [ui, setUi] = useState<Ui>(() => uiOf(startPlayback()));
  /** Bumped by a seek, Replay or Skip, so the voice starts over where the film now is. */
  const [epoch, setEpoch] = useState(0);
  const [heard, setHeard] = useState({ shot: -1, word: -1 });
  const [talking, setTalking] = useState(false);
  const [subs, setSubs] = useState(prefs.subtitles);
  // the master mute (shared/audio.ts): the button here sets it for the whole game
  const [muted, setMuted] = useState(isMasterMuted);
  const [voiceVol, setVoiceVol] = useState(prefs.voice);
  const [audioOpen, setAudioOpen] = useState(false);
  const [hots, setHots] = useState<Hotspot[]>([]);
  const [hover, setHover] = useState<{ spot: Hotspot; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [filesOpen, setFilesOpen] = useState(false);

  const narrator = useRef<Narrator | null>(null);
  const live = useRef({ talking: false, confirm: false, hover: null as string | null, onClose, onStart, right: 0, overlay: false });
  const mouse = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const hotRef = useRef<Hotspot[]>([]);
  const heardRef = useRef(heard);
  /** How fast this browser's voice really talks (characters a second at rate 1), learned line by line. */
  const pace = useRef({ cps: 13, speaking: false });

  const right = quizScore(answers).right;
  const voiceOn = CAN_SPEAK && !muted;
  const talkingNow = voiceOn && talking && ui.playing && !ui.ended;

  useEffect(() => {
    live.current.talking = talkingNow;
    live.current.confirm = confirm;
    live.current.hover = hover?.spot.id ?? null;
    live.current.onClose = onClose;
    live.current.onStart = onStart;
    live.current.right = right;
    live.current.overlay = quizOpen || filesOpen;
    heardRef.current = heard;
    Object.assign(prefs, { voice: voiceVol, subtitles: subs });
  });

  // her voice lives as long as the film
  useEffect(() => {
    if (CAN_SPEAK) {
      const n = new Narrator();
      narrator.current = n;
    }
    const unmute = onMasterMute(setMuted);
    return () => {
      unmute();
      narrator.current?.dispose();
      narrator.current = null;
    };
  }, []);

  useEffect(() => {
    if (narrator.current) narrator.current.volume = voiceVol;
  }, [voiceVol]);

  // the picture: every frame, from the timeline's clock
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const size = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    };
    size();
    window.addEventListener('resize', size);
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let lastHots = 0;
    let lastShot = -1;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!live.current.confirm && !live.current.overlay) play.current = advance(play.current, dt);
      const p = play.current;
      const i = shotIndex(p.t);
      const shot = SHOTS[i]!;
      const st = p.t - shot.t0;
      const m = mouse.current;
      const ease = 1 - Math.exp(-dt * 3);
      m.sx += (m.x - m.sx) * ease;
      m.sy += (m.y - m.sy) * ease;
      const talk = live.current.talking ? 0.5 + 0.5 * Math.abs(Math.sin(now / 1000 * 9) * Math.sin(now / 1000 * 3.7 + 1)) : 0;
      const f: Frame = { g, W, H, dpr, t: p.t, st, u: st / (shot.t1 - shot.t0), mx: reduced ? 0 : m.sx, my: reduced ? 0 : m.sy, talk, hover: live.current.hover, reduced, hot: [] };
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      paintShot(shot.id, f);
      // every cut dips through the dark with a thread of Kiro's cyan, so the shots run on from each other
      if (i > 0 && st < 0.45 && !p.ended) {
        const k = 1 - st / 0.45;
        g.fillStyle = `rgba(0, 0, 0, ${(k * 0.9).toFixed(3)})`;
        g.fillRect(0, 0, W, H);
        const y = H * (0.5 + 0.1 * Math.sin(i * 2.1));
        const grd = g.createLinearGradient(0, y - 2, W, y + 2);
        grd.addColorStop(0, 'rgba(70, 232, 255, 0)');
        grd.addColorStop(0.5, `rgba(70, 232, 255, ${(k * 0.7).toFixed(3)})`);
        grd.addColorStop(1, 'rgba(70, 232, 255, 0)');
        g.fillStyle = grd;
        g.fillRect(0, y - 1.5, W, 3);
      }
      if (p.ended) {
        g.fillStyle = 'rgba(0, 0, 0, 0.85)';
        g.fillRect(0, 0, W, H);
      }
      hotRef.current = p.ended ? [] : f.hot;
      if (i !== lastShot || now - lastUi > 120 || p.ended) {
        lastShot = i;
        lastUi = now;
        setUi((u) => {
          const n = uiOf(p);
          return u.shot === n.shot && u.playing === n.playing && u.ended === n.ended && Math.abs(u.t - n.t) < 0.1 && u.seen === n.seen ? u : n;
        });
      }
      if (now - lastHots > 250) {
        lastHots = now;
        const next = hotRef.current;
        setHots((h) => (h.length === next.length && h.every((x, k) => x.id === next[k]!.id && Math.abs(x.x - next[k]!.x) < 4 && Math.abs(x.y - next[k]!.y) < 4) ? h : next.slice()));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, []);

  // Kiro's voice: each shot's line, from the top or from where the film is in it; quiet when paused or muted
  const shotNow = ui.shot;
  // at the end card his last words are let finish; muting, pausing or leaving still stops him
  const sayKey = !voiceOn ? 'off' : ui.ended ? 'end' : ui.playing && !confirm && !quizOpen && !filesOpen ? 'on' : 'paused';
  useEffect(() => {
    const n = narrator.current;
    if (!n) return;
    if (sayKey === 'end') return;
    if (sayKey !== 'on') {
      n.stop();
      pace.current.speaking = false;
      return;
    }
    const shot = SHOTS[shotNow]!;
    const elapsed = play.current.t - shot.t0;
    const h = heardRef.current;
    let from = 0;
    if (h.shot === shotNow && h.word > 0) from = wordStart(shot.line, h.word);
    else if (elapsed > LINE_DELAY + 0.6) {
      const words = Math.floor(((elapsed - LINE_DELAY) / lineSeconds(shot.line)) * shot.line.split(/\s+/).length);
      from = wordIndex(shot.line, words);
    }
    if (from >= shot.line.length) return;
    const text = shot.line.slice(from);
    let timer = 0;
    let started = 0;
    const speak = () => {
      // fit what is left of the line into what is left of the shot, at this voice's real speed
      const left = shot.t1 - play.current.t - 0.3;
      n.rate = paceFor(text, left, pace.current.cps);
      n.say(text, {
        onStart: () => {
          started = performance.now();
          pace.current.speaking = true;
          setTalking(true);
        },
        onWord: (i) => setHeard({ shot: shotNow, word: from + i }),
        onEnd: () => {
          pace.current.speaking = false;
          setTalking(false);
          setHeard({ shot: shotNow, word: shot.line.length });
          const took = (performance.now() - started) / 1000;
          if (started && took > 0.8) pace.current.cps = 0.5 * pace.current.cps + 0.5 * (spokenLength(text) / took / n.rate);
        },
        onFail: () => {
          pace.current.speaking = false;
          setTalking(false);
        },
      });
    };
    // a line still finishing from the last shot gets a moment to end before this one starts
    const begin = (waited: number) => {
      if (pace.current.speaking && waited < 700) timer = window.setTimeout(() => begin(waited + 50), 50);
      else speak();
    };
    timer = window.setTimeout(() => begin(0), Math.max(0, (LINE_DELAY - elapsed) * 1000));
    return () => window.clearTimeout(timer);
  }, [sayKey, shotNow, epoch]);

  // keys: Space pauses, Escape asks, M mutes
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const L = live.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // the files panel handles its own Escape (a place may use it first, to zoom back out); the check closes here
        if (L.overlay) setQuizOpen(false);
        else if (play.current.ended) L.onClose(play.current.seen, L.right);
        else setConfirm((c) => !c);
        return;
      }
      if (L.overlay || L.confirm) return;
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        e.stopPropagation();
        play.current = togglePlay(play.current);
        if (play.current.t === 0) setEpoch((x) => x + 1);
        setUi(uiOf(play.current));
      } else if (e.key === 'm' || e.key === 'M') {
        e.stopPropagation();
        setMasterMuted(!isMasterMuted());
      }
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);

  const jump = (p: Playback) => {
    play.current = p;
    setHeard({ shot: -1, word: -1 });
    setEpoch((x) => x + 1);
    setUi(uiOf(p));
  };

  const onPointer = (e: RPointerEvent) => {
    mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    const spot = hotRef.current.find((h) => e.clientX >= h.x && e.clientX <= h.x + h.w && e.clientY >= h.y && e.clientY <= h.y + h.h);
    setHover((cur) => (spot ? (cur?.spot.id === spot.id && Math.abs(cur.x - e.clientX) < 6 && Math.abs(cur.y - e.clientY) < 6 ? cur : { spot, x: e.clientX, y: e.clientY }) : null));
  };

  const shot = SHOTS[ui.shot]!;
  const elapsed = ui.t - shot.t0;
  const est = Math.floor(((elapsed - LINE_DELAY) / lineSeconds(shot.line)) * shot.line.split(/\s+/).length);
  const shown = heard.shot === ui.shot && heard.word >= 0 ? heard.word + 1 : wordIndex(shot.line, Math.max(0, est)) + 1;
  const captionOn = shot.caption && !ui.ended && elapsed > 0.7 && elapsed < shot.t1 - shot.t0 - 0.2;

  return (
    <div className={`cin-root${ui.ended ? ' ended' : ''}${hover ? ' pointing' : ''}`} role="dialog" aria-label="The briefing" onPointerMove={onPointer} onPointerLeave={() => setHover(null)}>
      <canvas ref={canvasRef} className="cin-canvas" aria-hidden="true" />
      <div className="cin-grain" aria-hidden="true" />
      <div className="cin-vignette" aria-hidden="true" />

      {/* the things on screen, for the keyboard: each a focusable region with its fact */}
      <div className="cin-hots">
        {hots.map((h) => (
          <button
            key={h.id}
            type="button"
            className={`cin-hot ${h.tone}`}
            style={{ left: h.x, top: h.y, width: h.w, height: h.h } as CSSProperties}
            aria-label={`${h.title}: ${h.body}`}
            onFocus={() => setHover({ spot: h, x: h.x + h.w / 2, y: h.y })}
            onBlur={() => setHover(null)}
          />
        ))}
      </div>

      {hover && !ui.ended && (
        <div className={`cin-tip ${hover.spot.tone}`} style={{ left: Math.min(window.innerWidth - 360, Math.max(16, hover.x + 16)), top: Math.max(16, hover.y - 20) }} role="tooltip">
          <b>{hover.spot.title}</b>
          <span>{hover.spot.body}</span>
        </div>
      )}

      {captionOn && (
        <p className="cin-caption" key={shot.id}>
          {shot.caption}
        </p>
      )}

      {subs && !ui.ended && elapsed > LINE_DELAY && (
        <div className="cin-subs" aria-live="polite">
          <p>
            {shot.line.split(' ').map((w, k, all) => {
              const at = all.slice(0, k).join(' ').length + (k ? 1 : 0);
              const state = shown > at + w.length ? 'said' : shown > at ? 'now' : 'later';
              return (
                <span key={k} className={`cin-w ${state}`}>
                  {w}{' '}
                </span>
              );
            })}
          </p>
        </div>
      )}

      {!ui.ended && (
        <>
          <button type="button" className="cin-skip" onClick={() => jump(skipToEnd(play.current))}>
            Skip ⏭
          </button>
          <div className="cin-bar">
            <div className="cin-progress">
              {SHOTS.map((s, i) => (
                <button key={s.id} type="button" className={`cin-seg${i === ui.shot ? ' now' : ''}`} style={{ flexGrow: s.t1 - s.t0 }} onClick={() => jump(seekTo(play.current, s.t0))} aria-label={`Go to ${s.id}`}>
                  <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, (ui.t - s.t0) / (s.t1 - s.t0)))})` }} />
                </button>
              ))}
            </div>
            <div className="cin-row">
              <button type="button" className="cin-ctl" onClick={() => {
                play.current = togglePlay(play.current);
                setUi(uiOf(play.current));
              }} aria-label={ui.playing ? 'Pause' : 'Play'}>
                {ui.playing ? '❚❚' : '▶'}
              </button>
              <button type="button" className="cin-ctl" onClick={() => jump(replay(play.current))} aria-label="Replay">
                ↻
              </button>
              <span className="cin-time">
                {mmss(ui.t)} / {mmss(TOTAL)}
              </span>
              <span className="cin-gap" />
              <button type="button" className={`cin-ctl text${subs ? ' on' : ''}`} onClick={() => setSubs((s) => !s)} aria-pressed={subs} title="Subtitles">
                CC
              </button>
              <button type="button" className="cin-ctl" onClick={() => setMasterMuted(!isMasterMuted())} aria-label={muted ? 'Unmute all sound' : 'Mute all sound'} aria-pressed={muted} title="Mute all sound (M)">
                {muted ? '🔇' : '🔊'}
              </button>
              <button type="button" className={`cin-ctl text${audioOpen ? ' on' : ''}`} onClick={() => setAudioOpen((o) => !o)} aria-expanded={audioOpen} title="Sound">
                ♪
              </button>
              {audioOpen && (
                <div className="cin-audio">
                  <label>
                    <span>Kiro's voice</span>
                    <input type="range" min={0} max={1} step={0.05} value={voiceVol} onChange={(e) => setVoiceVol(Number(e.target.value))} disabled={!CAN_SPEAK} />
                  </label>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {confirm && (
        <div className="cin-confirm" role="alertdialog" aria-label="Leave the briefing?">
          <h2>Paused</h2>
          <div className="cin-confirm-row">
            <button type="button" className="cin-btn" autoFocus onClick={() => setConfirm(false)}>
              Keep watching
            </button>
            <button type="button" className="cin-btn" onClick={() => {
              setConfirm(false);
              jump(skipToEnd(play.current));
            }}>
              Skip to the end
            </button>
            <button type="button" className="cin-btn danger" onClick={() => onClose(play.current.seen, right)}>
              Leave the briefing
            </button>
          </div>
        </div>
      )}

      {ui.ended && !quizOpen && !filesOpen && (
        <div className="cin-end">
          <LogoCanvas title={title} className="cin-logo" />
          <p className="cin-tagline">{TAGLINE.join(' ')}</p>
          <button type="button" className="cin-start" autoFocus onClick={() => onStart(play.current.seen, right)}>
            [ Start the night shift ]
          </button>
          <div className="cin-end-row">
            <button type="button" className="cin-btn" onClick={() => jump(replay(play.current))}>
              ↻ Replay
            </button>
            <button type="button" className="cin-btn" onClick={() => setQuizOpen(true)}>
              {Object.keys(answers).length ? `Quick check · ${right} of ${QUIZ.length}` : `Quick check · ${QUIZ.length} questions`}
            </button>
            <button type="button" className="cin-btn" onClick={() => setFilesOpen(true)}>
              Briefing files
            </button>
          </div>
        </div>
      )}

      {quizOpen && <QuickCheck answers={answers} onAnswer={(id, a) => setAnswers((x) => (x[id] === undefined ? { ...x, [id]: a } : x))} onClose={() => setQuizOpen(false)} />}
      {filesOpen && <BriefingFiles onClose={() => setFilesOpen(false)} />}
    </div>
  );
}

/** The optional three-question check: one question at a time, the answer green or red, the fact from the files. */
function QuickCheck({ answers, onAnswer, onClose }: { answers: Readonly<Record<string, number>>; onAnswer: (id: string, a: number) => void; onClose: () => void }) {
  const [i, setI] = useState(() => Math.max(0, QUIZ.findIndex((q) => answers[q.id] === undefined)));
  const q = QUIZ[Math.min(i, QUIZ.length - 1)]!;
  const picked = answers[q.id];
  const done = Object.keys(answers).length === QUIZ.length;
  const { right } = quizScore(answers);
  return (
    <div className="cin-quiz" role="dialog" aria-label="Quick check">
      <p className="cin-quiz-step">
        Question {Math.min(i, QUIZ.length - 1) + 1} of {QUIZ.length}
      </p>
      <h2>{q.ask}</h2>
      <div className="cin-quiz-options">
        {q.options.map((o, k) => {
          const cls = picked === undefined ? '' : k === q.answer ? ' right' : k === picked ? ' wrong' : ' faded';
          return (
            <button key={o} type="button" className={`cin-option${cls}`} disabled={picked !== undefined} onClick={() => onAnswer(q.id, k)} autoFocus={k === 0 && picked === undefined}>
              <kbd>{k + 1}</kbd>
              {o}
            </button>
          );
        })}
      </div>
      {picked !== undefined && (
        <p className={`cin-quiz-reveal ${picked === q.answer ? 'right' : 'wrong'}`}>
          <b>{picked === q.answer ? 'Correct.' : 'Not quite.'}</b> {q.reveal}
        </p>
      )}
      <div className="cin-quiz-row">
        {done && <span className="cin-quiz-score">{right} of {QUIZ.length} right</span>}
        {picked !== undefined && i < QUIZ.length - 1 && (
          <button type="button" className="cin-btn" autoFocus onClick={() => setI(i + 1)}>
            Next question
          </button>
        )}
        <button type="button" className="cin-btn" onClick={onClose} autoFocus={done}>
          {done ? 'Back' : 'Close'}
        </button>
      </div>
    </div>
  );
}
