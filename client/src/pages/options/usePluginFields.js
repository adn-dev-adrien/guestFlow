/**
 * usePluginFields — what live plugins add to an option or resource editor (slots `options.fields` and
 * `resources.fields`, specs/plugins-phase-1-sdk.md rule 13).
 *
 * A contribution is `{ key, Component, appliesTo?(draft), section? }`:
 *   - without `section`, it edits the draft itself (`onChange(patch)` merges into the host's form, the host's
 *     payload carries it) — the hourly block of a resource;
 *   - with `section: { title }`, it is a section of its own at the bottom of the editor and keeps its own rows
 *     (a plugin's table), so nothing in the core payload changes: it calls `registerSave(fn)` with the save the host runs after its own, and
 *     `onDirtyChange(dirty)` so « Enregistrer » and the unsaved-changes guard count it.
 *
 * Returns `{ inline, sections, dirty, saveAll(itemId), bind(contribution) }`. `bind` hands a contribution the
 * stable `registerSave` / `onDirtyChange` pair for its key.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSlot } from '../../plugins/sdk';

const idOf = (c) => `${c.pluginId}:${c.key}`;

export default function usePluginFields(slot, draft) {
  const all = useSlot(slot);
  const savers = useRef(new Map());
  const bindings = useRef(new Map());
  const [dirtyKeys, setDirtyKeys] = useState({});

  const applies = draft ? all.filter((c) => !c.appliesTo || c.appliesTo(draft)) : [];
  const inline = applies.filter((c) => !c.section);
  const sections = applies.filter((c) => c.section);

  const setDirty = useCallback((id, dirty) => {
    setDirtyKeys((prev) => (Boolean(prev[id]) === Boolean(dirty) ? prev : { ...prev, [id]: Boolean(dirty) }));
  }, []);

  const bind = useCallback((c) => {
    const id = idOf(c);
    if (!bindings.current.has(id)) {
      bindings.current.set(id, {
        registerSave: (fn) => {
          savers.current.set(id, fn);
          return () => {
            if (savers.current.get(id) === fn) savers.current.delete(id);
            setDirty(id, false);
          };
        },
        onDirtyChange: (dirty) => setDirty(id, dirty),
      });
    }
    return bindings.current.get(id);
  }, [setDirty]);

  const dirty = useMemo(() => Object.values(dirtyKeys).some(Boolean), [dirtyKeys]);

  /** Runs every dirty plugin save, in slot order; the first refusal stops and is thrown to the host. */
  const saveAll = useCallback(async (itemId) => {
    for (const c of sections) {
      const id = idOf(c);
      const save = savers.current.get(id);
      if (save && dirtyKeys[id]) await save({ itemId });
    }
  }, [sections, dirtyKeys]);

  return {
    inline, sections, dirty, saveAll, bind,
  };
}
