import React from 'react';

/**
 * BedIcon — front-view bed pictogram, in colour (wood frame, sage duvet, cream pillow).
 *
 * Props:
 * - type: 'single' (narrow bed, 1 pillow) | 'double' (wider bed, 2 pillows). The single bed renders
 *   NARROWER than the double because the width follows the aspect ratio of a fixed height.
 * - height: px (default 20). Width is derived from the type's aspect ratio.
 * - title: accessible label (also a tooltip when wrapped).
 *
 * Used by the planning arrival cards (ReservationCard) in place of the "SIMPLE/DOUBLE" text, and
 * mirrored on the public WordPress accommodation pages.
 */
export default function BedIcon({ type = 'double', height = 20, title }) {
  const wood = '#a9794f';
  const duvet = '#8fae6e';
  const pillow = '#fbf7ec';
  const pillowEdge = '#e0d4bd';
  const isSingle = type === 'single';
  const vbW = isSingle ? 30 : 42;
  const width = Math.round((height * vbW) / 28);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${vbW} 28`} {...a11y}>
      {title ? <title>{title}</title> : null}
      {/* headboard */}
      <rect x="2" y="5" width={vbW - 4} height="5" rx="2" fill={wood} />
      {/* pillow(s) */}
      {isSingle ? (
        <rect x="9" y="8" width="12" height="6" rx="3" fill={pillow} stroke={pillowEdge} />
      ) : (
        <>
          <rect x="8" y="8" width="12" height="6" rx="3" fill={pillow} stroke={pillowEdge} />
          <rect x="22" y="8" width="12" height="6" rx="3" fill={pillow} stroke={pillowEdge} />
        </>
      )}
      {/* duvet / mattress */}
      <rect x="2" y="13" width={vbW - 4} height="9" rx="2" fill={duvet} />
      {/* legs */}
      <rect x="3" y="22" width="3" height="5" rx="1" fill={wood} />
      <rect x={vbW - 6} y="22" width="3" height="5" rx="1" fill={wood} />
    </svg>
  );
}
