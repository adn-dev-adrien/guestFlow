import React from 'react';

/**
 * BedIcon — front-view bed pictogram, drawn as a thin BLACK line icon (outline, no fill).
 *
 * Props:
 * - type: 'single' (narrow bed, 1 pillow) | 'double' (wider bed, 2 pillows). The single bed renders
 *   NARROWER than the double because the width follows the aspect ratio of a fixed height.
 * - height: px (default 20). Width is derived from the type's aspect ratio.
 * - title: accessible label (also a tooltip when wrapped).
 *
 * Used by the planning arrival cards (ReservationCard) in place of the "SIMPLE/DOUBLE" text. (The
 * public WordPress accommodation pages use a coloured variant — kept separate by design.)
 */
export default function BedIcon({ type = 'double', height = 20, title }) {
  const stroke = '#1f2937'; // near-black line
  const isSingle = type === 'single';
  const vbW = isSingle ? 30 : 42;
  const width = Math.round((height * vbW) / 28);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbW} 28`}
      fill="none"
      stroke={stroke}
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {/* headboard */}
      <rect x="2.5" y="5" width={vbW - 5} height="5" rx="2" />
      {/* pillow(s) */}
      {isSingle ? (
        <rect x="9" y="8" width="12" height="6" rx="3" />
      ) : (
        <>
          <rect x="8" y="8" width="12" height="6" rx="3" />
          <rect x="22" y="8" width="12" height="6" rx="3" />
        </>
      )}
      {/* mattress */}
      <rect x="2.5" y="13" width={vbW - 5} height="9" rx="2" />
      {/* legs */}
      <path d={`M4 22v5M${vbW - 4} 22v5`} />
    </svg>
  );
}
