/**
 * The open page's title, published by its `PageActionBar` and read by the top bar, which shows it on
 * a phone (specs/shell-and-home-day-first.md rule 15).
 *
 *   <PageTitleProvider>        around the shell
 *   usePublishPageTitle(title) in the page bar — the latest mounted bar wins; it clears on unmount
 *   usePageTitle()             in the top bar → string | null
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PageTitleContext = createContext({ title: null, publish: () => () => {} });

export function PageTitleProvider({ children }) {
  const [title, setTitle] = useState(null);
  const publish = useCallback((next) => {
    setTitle(next);
    return () => setTitle((current) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ title, publish }), [title, publish]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePublishPageTitle(title) {
  const { publish } = useContext(PageTitleContext);
  useEffect(() => (title ? publish(title) : undefined), [title, publish]);
}

export function usePageTitle() {
  return useContext(PageTitleContext).title;
}
