import React from 'react';
import { VISUAL_ASSETS } from '../constants';

export const NoiseOverlay: React.FC = React.memo(() => {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 opacity-[0.05] mix-blend-soft-light">
      <div className="absolute inset-0 bg-noise" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(221,184,176,0.08),transparent_30%)]" />
      {VISUAL_ASSETS.noiseOverlay && (
        <div
          className="absolute inset-0 opacity-20"
          style={{ backgroundImage: `url('${VISUAL_ASSETS.noiseOverlay}')` }}
        />
      )}
    </div>
  );
});

