// Client-only notification sound, synthesized with the Web Audio API.
// No audio asset is shipped: the "bubble pop" is generated live, so it works
// offline and carries no licensing baggage. SSR-safe (all access is guarded).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

// Browsers block audio until the user interacts with the page (autoplay policy).
// Call this from a real user gesture (e.g. the toggle's click handler) to unlock
// — afterwards programmatic playback (on a new alert) is allowed.
export function primeAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

// A short "bubble pop": a sine that blips up then settles, with a fast
// exponential decay. Tweak the three frequency stops / decay time below to
// reshape the character (higher = brighter, longer decay = softer).
export function playBubble(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();

  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.06); // quick blip up
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.2); // settle = "bubble"

  // Fast attack, exponential decay (exponential ramps can't hit 0, so use a floor).
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}
