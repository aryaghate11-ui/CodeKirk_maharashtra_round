import React, { useState, useEffect } from 'react';
import BlockDrift from '../originkit/ui/block-drift';

export interface BlockDriftBackgroundProps {
  near?: string;
  far?: string;
  edge?: string;
  grid?: number;
  layers?: number;
  density?: number;
  blockSize?: number;
  gap?: number;
  edgeWidth?: number;
  fade?: number;
  shade?: number;
  clearCentre?: number;
  speed?: number;
}

export const BlockDriftBackground: React.FC<BlockDriftBackgroundProps> = ({
  near = '#041812',
  far = '#10b981',
  edge = '#34d399',
  grid = 13,
  layers = 12,
  density = 9,
  blockSize = 9,
  gap = 16,
  edgeWidth = 1.2,
  fade = 2,
  shade = 18,
  clearCentre = 3,
  speed = 10,
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check if user has requested reduced motion
    try {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);

      const handler = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handler);
        return () => mediaQuery.removeListener(handler);
      }
    } catch (e) {
      // In non-browser or older environments, fallback to normal motion
      setPrefersReducedMotion(false);
    }
  }, []);

  // Compute effective speed:
  // - If caller explicitly requested 0, honor it.
  // - If prefersReducedMotion is active, use a calm, gentle ambient drift (speed 2)
  //   rather than freezing the scene to 0 (which appears as a broken/frozen canvas).
  // - In normal browser settings, ensure dynamic, visibly moving forward corridor speed (>= 8).
  const effectiveSpeed = speed === 0
    ? 0
    : prefersReducedMotion
      ? Math.min(speed, 2)
      : Math.max(speed, 8);

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Official Originkit WebGL Block Drift Background */}
      <div className="absolute inset-0">
        <BlockDrift
          near={near}
          far={far}
          edge={edge}
          grid={grid}
          layers={layers}
          density={density}
          blockSize={blockSize}
          gap={gap}
          edgeWidth={edgeWidth}
          fade={fade}
          shade={shade}
          clearCentre={clearCentre}
          speed={effectiveSpeed}
          direction="front"
        />
      </div>

      {/* Atmospheric dark gradient overlays calibrated for high Block Drift visibility while maintaining crisp contrast */}
      <div className="absolute inset-0 bg-gradient-to-b from-brand-bg/40 via-brand-bg/20 to-brand-bg/55 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_10%,rgba(16,185,129,0.06),transparent)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.04),transparent_50%)] pointer-events-none" />
    </div>
  );
};
