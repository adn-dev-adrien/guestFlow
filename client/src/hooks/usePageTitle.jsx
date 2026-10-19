/**
 * The open page's title, published by its `PageActionBar` and read by the top bar, which shows it on
 * a phone (specs/shell-and-home-day-first.md rule 15).
 *
 *   <PageTitleProvider>        around the shell
 *   usePublishPageTitle(title) in the page bar — the latest mounted bar wins; it clears on unmount
 *   usePageTitle()             in the top bar → string | null
 *
 * The top bar also holds a slot for the page's one action on a phone: a page bar with nothing else
 * to show renders its single button there rather than drawing a band of its own
 * (specs/shell-and-home-day-first.md rule 23).
 *   <TopBarActionSlot />       in the top bar (kept mounted, hidden, while the phone search is open)
 *   useTopBarActionSlot()      in the page bar → the slot's element | null (null when the title
 *                              would be cut beside a button: useSetTopBarTitleRoom, set by the top bar)
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PageTitleContext = createContext({
  title: null, publish: () => () => {}, actionSlot: null, setActionSlot: () => {}, titleRoom: true, setTitleRoom: () => {},
});

export function PageTitleProvider({ children }) {
  const [title, setTitle] = useState(null);
  const [actionSlot, setActionSlot] = useState(null);
  // False when the top bar's title would be cut beside one more button (measured by the top bar).
  const [titleRoom, setTitleRoom] = useState(true);
  const publish = useCallback((next) => {
    setTitle(next);
    return () => setTitle((current) => (current === next ? null : current));
  }, []);
  const value = useMemo(
    () => ({ title, publish, actionSlot, setActionSlot, titleRoom, setTitleRoom }),
    [title, publish, actionSlot, titleRoom],
  );
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePublishPageTitle(title) {
  const { publish } = useContext(PageTitleContext);
  useEffect(() => (title ? publish(title) : undefined), [title, publish]);
}

export function usePageTitle() {
  return useContext(PageTitleContext).title;
}

/** The slot, or null when the title has no room left for a button beside it. */
export function useTopBarActionSlot() {
  const { actionSlot, titleRoom } = useContext(PageTitleContext);
  return titleRoom ? actionSlot : null;
}

export function useSetTopBarTitleRoom() {
  return useContext(PageTitleContext).setTitleRoom;
}

/**
 * The slot itself. It stays mounted while the phone search covers the bar (`hidden`), so the page
 * bar does not redraw its band and move the page.
 */
export function TopBarActionSlot({ hidden = false }) {
  const { setActionSlot } = useContext(PageTitleContext);
  return (
    <span
      ref={setActionSlot}
      data-testid="appbar-page-action"
      data-topbar-slot=""
      style={{ display: hidden ? 'none' : 'flex', alignItems: 'center', order: 1 }}
    />
  );
}
