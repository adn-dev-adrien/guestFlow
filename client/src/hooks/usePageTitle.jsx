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
 *   <TopBarActionSlot />       in the top bar
 *   useTopBarActionSlot()      in the page bar → the slot's element | null
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PageTitleContext = createContext({ title: null, publish: () => () => {}, actionSlot: null, setActionSlot: () => {} });

export function PageTitleProvider({ children }) {
  const [title, setTitle] = useState(null);
  const [actionSlot, setActionSlot] = useState(null);
  const publish = useCallback((next) => {
    setTitle(next);
    return () => setTitle((current) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ title, publish, actionSlot, setActionSlot }), [title, publish, actionSlot]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePublishPageTitle(title) {
  const { publish } = useContext(PageTitleContext);
  useEffect(() => (title ? publish(title) : undefined), [title, publish]);
}

export function usePageTitle() {
  return useContext(PageTitleContext).title;
}

export function useTopBarActionSlot() {
  return useContext(PageTitleContext).actionSlot;
}

export function TopBarActionSlot() {
  const { setActionSlot } = useContext(PageTitleContext);
  return <span ref={setActionSlot} data-testid="appbar-page-action" style={{ display: 'contents' }} />;
}
