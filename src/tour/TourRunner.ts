import { useStore } from '@/state/useStore';
import type { Tour, TourStep } from '@/story/types';

/** Silence between steps, so one thought lands before the next begins. */
const GAP_MS = 900;
/** Speaking pace used to time a dial sweep under browser speech, which reports no duration. */
const WORDS_PER_SECOND = 2.6;

/** Something narrating one step: recorded audio or the browser's speech. */
interface Narration {
  /** 0..1 through the step, for sweeping the dial in time with the voice. */
  progress(): number;
  pause(): void;
  resume(): void;
  cancel(): void;
}

/**
 * Picks the browser voice. Local voices first: they need no network and, unlike
 * Chrome's cloud voices, do not cut off long sentences.
 */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
  const local = voices.filter((voice) => voice.localService);
  const preferred = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Google US English'];
  for (const name of preferred) {
    const match = [...local, ...voices].find((voice) => voice.name.includes(name));
    if (match) return match;
  }
  return local[0] ?? voices[0];
}

/**
 * Reads text with the browser's speech, one sentence per utterance. Long single
 * utterances can stall or stop early in some browsers; sentences are short enough
 * not to.
 */
function speak(text: string, onDone: () => void): Narration {
  const synth = window.speechSynthesis;
  const sentences = text.match(/[^.!?]+[.!?]+["”’]?\s*/g) ?? [text];
  const voice = pickVoice();
  const started = performance.now();
  const estimate = (text.split(/\s+/).length / WORDS_PER_SECOND) * 1000;
  let pausedAt: number | null = null;
  let pausedTotal = 0;
  let cancelled = false;

  synth.cancel();
  sentences.forEach((sentence, index) => {
    const utterance = new SpeechSynthesisUtterance(sentence.trim());
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    if (index === sentences.length - 1) {
      utterance.onend = () => {
        if (!cancelled) onDone();
      };
    }
    synth.speak(utterance);
  });

  return {
    progress: () => {
      const now = pausedAt ?? performance.now();
      return Math.min(1, (now - started - pausedTotal) / estimate);
    },
    pause: () => {
      pausedAt = performance.now();
      synth.pause();
    },
    resume: () => {
      if (pausedAt !== null) pausedTotal += performance.now() - pausedAt;
      pausedAt = null;
      synth.resume();
    },
    cancel: () => {
      cancelled = true;
      synth.cancel();
    },
  };
}

/** Plays a recorded narration file. */
function playAudio(src: string, onDone: () => void, onError: () => void): Narration {
  const audio = new Audio(src);
  let cancelled = false;
  audio.onended = () => {
    if (!cancelled) onDone();
  };
  audio.onerror = () => {
    if (!cancelled) onError();
  };
  void audio.play().catch(() => {
    if (!cancelled) onError();
  });
  return {
    progress: () => (audio.duration > 0 ? audio.currentTime / audio.duration : 0),
    pause: () => audio.pause(),
    resume: () => void audio.play(),
    cancel: () => {
      cancelled = true;
      audio.pause();
      audio.src = '';
    },
  };
}

/**
 * Plays a story's narrated tour.
 *
 * Each step sets the whole view, then narrates; when the narration ends the next
 * step begins. A step with `sweepTo` moves the dial in time with the voice, so the
 * map is changing while the narrator describes the change.
 *
 * All view changes go through the store, exactly as a puck's would, so the charts,
 * legend and readouts follow along with no tour-specific code. The runner never
 * touches the map camera: on the table it is registered to the relief model.
 *
 * Pucks are ignored while a tour plays (see `usePucks`); anything that sets the
 * tour back to `idle` stops the narration where it is.
 */
export class TourRunner {
  private narration: Narration | null = null;
  private timer: number | null = null;
  private frame: number | null = null;
  /** Set during the gap after a step: where to go next (the length means "finish"). */
  private pending: number | null = null;
  /** Bumped on every start and stop, so callbacks from an abandoned step do nothing. */
  private run = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly tour: Tour) {
    this.unsubscribe = useStore.subscribe((state, previous) => {
      if (state.tourStatus === 'idle' && previous.tourStatus !== 'idle') this.halt();
    });
  }

  get length() {
    return this.tour.steps.length;
  }

  play(from = 0) {
    this.halt();
    useStore.getState().setTour('playing', from);
    this.runStep(from);
  }

  pause() {
    if (useStore.getState().tourStatus !== 'playing') return;
    this.narration?.pause();
    // Paused in the gap between steps: hold the next step until resumed.
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    useStore.getState().setTour('paused');
  }

  resume() {
    if (useStore.getState().tourStatus !== 'paused') return;
    useStore.getState().setTour('playing');
    if (this.narration) this.narration.resume();
    else if (this.pending !== null) this.advance(this.pending, this.run);
    else this.runStep(useStore.getState().tourStep);
  }

  /** Stops, and puts the story back how it opens, ready for the next visitor. */
  stop() {
    this.halt();
    const store = useStore.getState();
    store.setTour('idle', 0);
    store.resetView();
  }

  skip(delta: number) {
    const next = Math.min(this.length - 1, Math.max(0, useStore.getState().tourStep + delta));
    this.play(next);
  }

  dispose() {
    this.halt();
    this.unsubscribe();
  }

  private runStep(index: number) {
    const step = this.tour.steps[index];
    if (!step) return;
    const run = ++this.run;
    this.pending = null;
    const store = useStore.getState();
    store.setTour('playing', index);
    store.applyView(step.view);

    const done = () => {
      if (run !== this.run) return;
      this.finishSweep(step);
      this.narration = null;
      this.pending = index + 1;
      if (useStore.getState().tourStatus === 'playing') this.advance(index + 1, run);
    };

    // A missing or unplayable recording falls back to speech rather than silence.
    const fallback = () => {
      if (run !== this.run) return;
      this.narration = speak(step.narration, done);
    };
    this.narration = step.audio ? playAudio(step.audio, done, fallback) : speak(step.narration, done);

    if (step.sweepTo !== undefined) this.sweep(step, run);
  }

  /** After the gap, the next step -- or the end. */
  private advance(next: number, run: number) {
    this.timer = window.setTimeout(() => {
      if (run !== this.run) return;
      this.pending = null;
      if (next < this.length) this.runStep(next);
      else this.finish(run);
    }, GAP_MS);
  }

  /** Moves the dial across the step in time with the narration. */
  private sweep(step: TourStep, run: number) {
    const from = step.view.year ?? useStore.getState().year;
    const to = step.sweepTo!;
    const tick = () => {
      if (run !== this.run || !this.narration) return;
      if (useStore.getState().tourStatus === 'playing') {
        const year = Math.round(from + (to - from) * this.narration.progress());
        if (year !== useStore.getState().year) useStore.getState().setYear(year);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finishSweep(step: TourStep) {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (step.sweepTo !== undefined) useStore.getState().setYear(step.sweepTo);
  }

  /**
   * The story is over: the pucks come back, on the final frame, so the visitor can
   * pick up from where the narrator left off.
   */
  private finish(run: number) {
    if (run !== this.run) return;
    this.halt();
    useStore.getState().setTour('idle', 0);
  }

  private halt() {
    this.run += 1;
    this.pending = null;
    this.narration?.cancel();
    this.narration = null;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
