/**
 * « Domotique » (specs/guest-app-home-automation.md §3.D, §3.E, §6): the lodging live — outdoors on the photo, the
 * rooms, the lights the owner entrusted to guests, the rain, the electricity and the exchange with the grid. Everything
 * is rendered from `/home` as the server wrote it: no figure is rounded, dated or scaled here. One moment of motion:
 * the light switch.
 */
import { useCallback } from 'react';
import AppBar from '../components/AppBar';
import Photo from '../components/Photo';
import Icon from '../components/Icon';
import Banner from '../components/Banner';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import Sparkbars from '../components/Sparkbars';
import EnergyCurve from '../components/EnergyCurve';
import LightSwitch from '../components/LightSwitch';
import { useSession } from '../hooks/useSession';
import { useHome } from '../hooks/useHome';
import { useLightSwitch } from '../hooks/useLightSwitch';
import { useOnline } from '../hooks/useOnline';
import { useT } from '../i18n';
import { DEFAULT_HERO } from './HomePage';

const GRID_ICON = { export: 'gridOut', import: 'gridIn', balanced: 'minus' };

function Hero({ outdoor, data, lodging, online, t }) {
  const live = online && data.live;
  const eyebrow = online
    ? `${t(live ? 'smartHome.live' : 'smartHome.lastReading')}${data.updated ? ` · ${data.updated}` : ''}`
    : t('smartHome.offlineShort');
  return (
    <Photo src={lodging.heroUrl || DEFAULT_HERO} scrim className={`sh-hero${outdoor ? '' : ' short'}`}>
      <div className="sh-hero-in">
        <p className="eb"><span className={`live-dot${live ? '' : ' muted'}`} aria-hidden="true" />{eyebrow}</p>
        {outdoor ? (
          <>
            <p className={`sh-big${outdoor.state === 'fresh' ? '' : ' stale'}`}>
              {outdoor.temperature !== null ? <>{outdoor.temperature}<span>°</span></> : <span className="na">{t('smartHome.unavailable')}</span>}
            </p>
            <p className="sh-lbl">{t('smartHome.outside')}{outdoor.state === 'stale' && outdoor.at ? ` · ${outdoor.at}` : ''}</p>
            <p className="sh-facts">
              {outdoor.min !== null && outdoor.max !== null ? <span>{t('smartHome.minMax', { min: outdoor.min, max: outdoor.max })}</span> : null}
              {outdoor.humidity ? <span><Icon name="humidity" />{outdoor.humidity}</span> : null}
              {outdoor.wind ? <span><Icon name="wind" />{outdoor.wind}</span> : null}
            </p>
            {outdoor.rain ? <p className="sh-rain"><Icon name="rain" />{outdoor.rain}</p> : null}
          </>
        ) : <h1 className="sh-name">{lodging.name}</h1>}
      </div>
    </Photo>
  );
}

function Rooms({ block, t }) {
  return (
    <section className="sh-sec" aria-labelledby="sh-rooms">
      <h2 id="sh-rooms">{t('smartHome.rooms')}</h2>
      <div className="sh-rooms">
        {block.items.map((room) => (
          <div key={room.id} className={`sh-room${room.state === 'stale' ? ' stale' : ''}`}>
            <span className="n">{room.label}</span>
            {room.temperature !== null ? (
              <span className="t"><b>{room.temperature}</b><i>°C</i></span>
            ) : <span className="t na">{t('smartHome.unavailable')}</span>}
            {room.min !== null && room.max !== null ? <span className="mm">{t('smartHome.minMax', { min: room.min, max: room.max })}</span> : null}
            {room.humidity || (room.state === 'stale' && room.at) ? (
              <span className="h">{[room.humidity ? t('smartHome.humidity', { v: room.humidity }) : null, room.state === 'stale' ? room.at : null].filter(Boolean).join(' · ')}</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Rain({ block, t }) {
  return (
    <section className="sh-sec" aria-labelledby="sh-rain">
      <h2 id="sh-rain">{t('smartHome.rain')}{block.state === 'stale' && block.at ? <small>{block.at}</small> : null}</h2>
      <div className={`sh-card${block.state === 'stale' ? ' stale' : ''}`}>
        <div className="sh-kv">
          {block.today ? <div><b>{block.today}</b><span>{t('smartHome.today')}</span></div> : null}
          {block.lastHour ? <div><b>{block.lastHour}</b><span>{t('smartHome.lastHour')}</span></div> : null}
          {block.last24h ? <div><b>{block.last24h}</b><span>{t('smartHome.last24h')}</span></div> : null}
        </div>
        {block.bars.some((v) => v !== null) ? (
          <>
            <Sparkbars values={block.bars} label={t('smartHome.rainChart')} />
            <div className="sh-axis"><span>{t('smartHome.ago24')}</span><span>{t('smartHome.now')}</span></div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Energy({ block, t }) {
  return (
    <section className="sh-sec" aria-labelledby="sh-energy">
      <h2 id="sh-energy">{t('smartHome.energy')}{block.state === 'stale' && block.at ? <small>{block.at}</small> : null}</h2>
      <div className={`sh-card${block.state === 'stale' ? ' stale' : ''}`}>
        <div className="sh-kv">
          {block.power ? <div><b>{block.power}</b><span>{t('smartHome.powerNow')}</span></div> : null}
          {block.today ? <div><b>{block.today}</b><span>{t('smartHome.today')}</span></div> : null}
        </div>
        {block.curve.some((v) => v !== null) ? (
          <>
            <EnergyCurve values={block.curve} label={t('smartHome.energyChart')} />
            <div className="sh-axis"><span>{t('smartHome.ago24')}</span><span>{t('smartHome.now')}</span></div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Rule 29 — the exchange with the grid as Sowel signs it, written unsigned by the server; the phrase says the way. */
function Grid({ block, t }) {
  return (
    <section className="sh-sec" aria-labelledby="sh-grid">
      <h2 id="sh-grid">{t('smartHome.grid')}{block.state === 'stale' && block.at ? <small>{block.at}</small> : null}</h2>
      <div className={`sh-card sh-grid${block.direction ? ` ${block.direction}` : ''}${block.state === 'stale' ? ' stale' : ''}`}>
        {block.power !== null ? (
          <>
            <b className="v">{block.power}</b>
            <span className="dir"><Icon name={GRID_ICON[block.direction]} />{block.label}</span>
          </>
        ) : <span className="na">{t('smartHome.unavailable')}</span>}
      </div>
    </section>
  );
}

/**
 * The page under its app bar: the hero, the banners, the blocks. Exported for the studio's phone preview, which draws
 * the same thing from the server's preview payload (specs/guest-app-home-automation.md rule 16).
 *
 * Props: `data` (the `/home` payload), `lodging` (`{ name, heroUrl }`), `online`, `taps` and `onPress` (the lights),
 * `refreshFailed` (the last read again failed while online: the values shown are the previous ones).
 */
export function SmartHomeBody({
  data, lodging, online = true, taps = {}, onPress = () => {}, refreshFailed = false,
}) {
  const t = useT();
  const blocks = data.blocks;
  const outdoor = blocks.find((b) => b.kind === 'outdoor');
  const texts = {
    switchingOn: t('smartHome.switchingOn'),
    switchingOff: t('smartHome.switchingOff'),
    readOnly: t('smartHome.readOnly'),
    noAnswer: t('smartHome.noAnswer'),
  };
  return (
    <>
      <Hero outdoor={outdoor} data={data} lodging={lodging} online={online} t={t} />
      <div className="pad sh-body">
        {!online ? <Banner tone="mut" icon="wifiOff">{t('smartHome.offline')}</Banner> : null}
        {online && !data.live && data.updated ? <Banner tone="warn" icon="alert">{t('smartHome.silent', { at: data.updated })}</Banner> : null}
        {online && refreshFailed ? <Banner tone="mut" icon="alert">{t('smartHome.refreshFailed')}</Banner> : null}
        {blocks.map((block) => {
          if (block.kind === 'rooms') return <Rooms key="rooms" block={block} t={t} />;
          if (block.kind === 'rain') return <Rain key="rain" block={block} t={t} />;
          if (block.kind === 'energy') return <Energy key="energy" block={block} t={t} />;
          if (block.kind === 'grid') return <Grid key="grid" block={block} t={t} />;
          if (block.kind === 'lights') {
            return (
              <section key="lights" className="sh-sec" aria-labelledby="sh-lights">
                <h2 id="sh-lights">{t('smartHome.lights')}</h2>
                <div className="sh-lights">
                  {block.items.map((light) => (
                    <LightSwitch key={light.id} light={light} tap={taps[light.id]} disabled={!online} onPress={onPress} texts={texts} />
                  ))}
                </div>
              </section>
            );
          }
          return null;
        })}
        <p className="hint sh-foot">{t('smartHome.foot')}</p>
      </div>
    </>
  );
}

export default function HomeAutomationPage() {
  const t = useT();
  const { lodging, lang } = useSession();
  const online = useOnline();
  const home = useHome(lang);
  const settle = useCallback(() => home.reload(), [home.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const { taps, press } = useLightSwitch({ onSettled: settle });
  const data = home.data;

  return (
    <div className="scroll enter smart-home">
      <AppBar title={t('smartHome.title')} back="/" />
      {home.error && !data ? <div className="pad"><ErrorAlert error={home.error} onRetry={home.reload} /></div> : null}
      {!data && !home.error ? <div className="pad"><Skeleton lines={6} label={t('common.loading')} /></div> : null}
      {data ? <SmartHomeBody data={data} lodging={lodging} online={online} taps={taps} onPress={press} refreshFailed={Boolean(home.error)} /> : null}
    </div>
  );
}
