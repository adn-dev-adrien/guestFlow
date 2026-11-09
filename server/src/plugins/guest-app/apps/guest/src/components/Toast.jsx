/**
 * Toast — one short confirmation at the bottom (« Copié »), gone after 2.4 s; announced politely.
 *
 * `ToastProvider` around the app, `useToast()(text)` anywhere.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [text, setText] = useState(null);
  const timer = useRef(null);
  const show = useCallback((next) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 2400);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">{text || ''}</div>
      {text ? <div className="toast" aria-hidden="true"><Icon name="check" />{text}</div> : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
