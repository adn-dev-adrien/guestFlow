/**
 * DirectionsLink — the one « Itinéraire » of the app (the « Pratique » sheet, the booklet's place block). A link to the Google Maps
 * directions URL; on an iPhone or iPad the click runs the Apple chain instead (Google Maps app, then Plans, then the web page).
 * Nothing is chosen, nothing is remembered.
 *
 * A payload without `links` (a booklet cached before them) draws no button. A second tap while the chain runs does nothing.
 *
 * Props: `links` (the server's `{ google, googleApp, appleApp }`), `className`, `icon` (an Icon name), `children` (the label).
 */
import { useRef } from 'react';
import Icon from './Icon';
import { isAppleDevice, openDirectionsOnApple } from '../utils/openDirections';

export default function DirectionsLink({ links, className = 'btn', icon = 'nav', children }) {
  const running = useRef(false);
  if (!links || !links.google) return null;
  const onClick = (event) => {
    if (!isAppleDevice()) return;
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    openDirectionsOnApple(links).finally(() => { running.current = false; });
  };
  return (
    <a className={className} href={links.google} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      <Icon name={icon} />
      {children}
    </a>
  );
}
