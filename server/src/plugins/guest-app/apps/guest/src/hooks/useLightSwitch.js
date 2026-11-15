/**
 * A guest's taps on the lights (specs/guest-app-home-automation.md rules 8, 22). The switch moves on the press; the
 * command is then followed until the house answers. Done → the page is read again (the state comes from the house);
 * refused or expired → the switch goes back and says why, for a few seconds.
 *
 * `{ taps, press(light) }` — `taps[lightId]` is `{ on, pending, message? }` while a tap is in flight or just failed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

export const POLL_MS = 1000;
export const POLL_LIMIT = 40;
export const MESSAGE_MS = 5000;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function useLightSwitch({ onSettled }) {
  const [taps, setTaps] = useState({});
  const alive = useRef(true);
  // Set on every mount: React's development double mount runs the cleanup once before the real mount.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const set = (id, value) => {
    if (!alive.current) return;
    setTaps((all) => {
      const next = { ...all };
      if (value) next[id] = value; else delete next[id];
      return next;
    });
  };
  const fail = (id, message) => {
    set(id, { pending: false, message });
    setTimeout(() => set(id, null), MESSAGE_MS);
  };

  const press = useCallback(async (light) => {
    const on = !light.on;
    set(light.id, { on, pending: true });
    let command;
    try {
      command = await api.switchLight(light.id, on);
    } catch (error) {
      fail(light.id, error.message);
      return;
    }
    for (let i = 0; i < POLL_LIMIT && alive.current; i += 1) {
      if (command.state === 'done') {
        await onSettled();
        set(light.id, null);
        return;
      }
      if (command.state === 'refused' || command.state === 'expired') {
        fail(light.id, command.message);
        return;
      }
      await wait(POLL_MS);
      try {
        command = await api.homeCommand(command.id);
      } catch (error) {
        if (error.code !== 'NETWORK') { fail(light.id, error.message); return; }
      }
    }
    fail(light.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSettled]);

  return { taps, press };
}
