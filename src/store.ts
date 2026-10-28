// Progress store persisted in localStorage. Pure transitions live in lib/progress.ts.
import { useSyncExternalStore } from 'react';
import { emptyState, logActivity, recordAttempt, type Mode, type ProgressState, type Activity } from './lib/progress';
import type { Question } from './lib/types';

const KEY = 'db-midterm-studio.v1';
const listeners = new Set<() => void>();

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1) return { ...emptyState(), ...s, settings: { ...emptyState().settings, ...s.settings } };
    }
  } catch {
    /* corrupted or blocked storage → start fresh */
  }
  return emptyState();
}

let state: ProgressState = load();
export let storageOk = true;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export function update(fn: (s: ProgressState) => ProgressState) {
  state = fn(state);
  save();
  listeners.forEach((l) => l());
}

export const getState = () => state;

export function useProgress(): ProgressState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function resetProgress() {
  update((s) => ({ ...emptyState(), settings: s.settings }));
}

export function recordAnswer(q: Question, ok: boolean, score: number, mode: Mode, hints: number, resp: string) {
  update((s) => recordAttempt(s, { q: q.id, m: q.module, skills: q.skills, ok, score, t: Date.now(), mode, hints, resp: resp.slice(0, 400) }));
}

export function activity(a: Omit<Activity, 't'>) {
  update((s) => logActivity(s, { ...a, t: Date.now() }));
}
