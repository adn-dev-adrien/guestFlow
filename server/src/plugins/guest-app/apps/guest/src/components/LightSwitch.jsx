/**
 * LightSwitch — one light of the « Domotique » page (specs/guest-app-home-automation.md rule 22): its name, its state
 * line, and — when the light is entrusted to guests — a 44 px switch that moves on the press. The lamp glyph warms
 * once the house has confirmed.
 *
 * Props: `light` (`{ id, label, on, status, pilotable, state, at }` from the server), `tap` (`{ on, pending, message }`
 * while a tap is in flight or just failed), `disabled`, `onPress`, `texts` (`{ pending, readOnly, noAnswer }`).
 */
import Icon from './Icon';

export default function LightSwitch({
  light, tap, disabled, onPress, texts,
}) {
  const pending = Boolean(tap && tap.pending);
  const failed = Boolean(tap && !tap.pending);
  const shownOn = pending ? tap.on : light.on === true;
  let line = light.status + (light.state === 'stale' && light.at ? ` · ${light.at}` : '');
  if (pending) line = tap.on ? texts.switchingOn : texts.switchingOff;
  if (failed) line = tap.message || texts.noAnswer;
  return (
    <div className="light">
      <span className={`bulb${light.on === true ? ' on' : ''}`}><Icon name="light" /></span>
      <span className="tx">
        <b>{light.label}</b>
        <span className={failed ? 'err' : ''} role={failed ? 'status' : undefined}>{line}</span>
      </span>
      {light.pilotable ? (
        <button
          type="button"
          className={`sw${pending ? ' busy' : ''}`}
          role="switch"
          aria-checked={shownOn}
          aria-label={light.label}
          disabled={disabled || pending || light.on === null}
          onClick={() => onPress(light)}
        >
          <span className="tr"><span className="kn" /></span>
        </button>
      ) : <span className="ro">{texts.readOnly}</span>}
    </div>
  );
}
