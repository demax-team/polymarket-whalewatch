"use client";

import { useEffect, useState } from "react";
import { playBubble, primeAudio } from "./sound";

// Single shared preference key, so the on/off state is consistent across every
// monitoring page (24h scanner, 实时告警, …).
const KEY = "ww_alert_sound";

// Manages the new-record sound preference: opt-in, persisted to localStorage.
// `toggle` flips it, and on ENABLE it unlocks audio inside the click gesture
// (browser autoplay policy) and plays a confirmation chime. The actual
// per-record chime is left to each page (it owns its "what is new" logic).
export function useSoundToggle(): { soundOn: boolean; toggle: () => void } {
  const [soundOn, setSoundOn] = useState(false);

  // Restore the saved preference on mount.
  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem(KEY) === "1");
    } catch {
      // localStorage unavailable (private mode etc.) — stay off.
    }
  }, []);

  function toggle() {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // ignore persistence failure
    }
    if (next) {
      primeAudio();
      playBubble();
    }
  }

  return { soundOn, toggle };
}
