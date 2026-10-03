import React from 'react';

interface QuorumLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  showTagline?: boolean;
}

export const QuorumLogo: React.FC<QuorumLogoProps> = ({
  className,
  size = 32,
  showText = false,
  showTagline = false,
}) => {
  return (
    <div className={`flex items-center gap-3 ${className || ''}`}>
      <div
        className="relative flex-shrink-0 grid place-items-center rounded-xl bg-brand-panel-elevated/90 border border-quorum-green-border/70 p-1.5 shadow-sm group"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full text-quorum-green transition-transform duration-300 group-hover:scale-105"
        >
          {/* Outer hexagonal perimeter */}
          <polygon
            points="24,4 42,14 42,34 24,44 6,34 6,14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
            className="text-brand-border-bright"
          />

          {/* Three convergent builder vectors focusing into the consensus hub */}
          {/* Builder 1 (Top) */}
          <path
            d="M24 8 L24 20"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="24" cy="8" r="2.5" fill="#10b981" />

          {/* Builder 2 (Bottom Right) */}
          <path
            d="M38 32 L28 26"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="38" cy="32" r="2.5" fill="#10b981" />

          {/* Builder 3 (Bottom Left) */}
          <path
            d="M10 32 L20 26"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="10" cy="32" r="2.5" fill="#10b981" />

          {/* Central Quorum Verified Core / Nexus */}
          <circle
            cx="24"
            cy="24"
            r="4.5"
            fill="#10b981"
            className="animate-pulse"
          />
          <circle
            cx="24"
            cy="24"
            r="7"
            stroke="#60e6ae"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-wider text-base text-white uppercase font-sans">
              QUORUM
            </span>
            <span className="text-[10px] font-mono tracking-widest px-1.5 py-0.5 rounded bg-quorum-green-bg border border-quorum-green-border text-quorum-green-light font-bold">
              v1.0
            </span>
          </div>
          {showTagline && (
            <span className="text-[11px] text-brand-muted tracking-tight truncate">
              Don't Trust the Binary. Trust the Builders.
            </span>
          )}
        </div>
      )}
    </div>
  );
};
