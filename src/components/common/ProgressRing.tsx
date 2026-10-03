import React from 'react';
import { cn } from '../../lib/utils';
import { Check, X, AlertTriangle } from 'lucide-react';

interface ProgressRingProps {
  current: number;
  total: number;
  threshold: number;
  satisfied: boolean;
  conflict?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  current,
  total,
  threshold,
  satisfied,
  conflict = false,
  size = 72,
  strokeWidth = 6,
  className,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = total > 0 ? Math.min(1, current / total) : 0;
  const strokeDashoffset = circumference - progressRatio * circumference;

  let colorStroke = '#10b981'; // Green
  let glowColor = 'rgba(16, 185, 129, 0.2)';

  if (!satisfied) {
    colorStroke = '#ef4444'; // Red
    glowColor = 'rgba(239, 68, 68, 0.2)';
  } else if (conflict) {
    colorStroke = '#f59e0b'; // Amber
    glowColor = 'rgba(245, 158, 11, 0.2)';
  }

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg
        width={size}
        height={size}
        className="rotate-[-90deg] transition-all duration-700 ease-out"
        style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
      >
        {/* Background track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1e293b"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress active stroke */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colorStroke}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      {/* Inner label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-sm font-bold text-brand-text leading-none">
          {current}/{total}
        </span>
        <span className="text-[10px] text-brand-muted mt-0.5 leading-none">
          k={threshold}
        </span>
      </div>
    </div>
  );
};

export const QuorumStatusBanner: React.FC<{
  satisfied: boolean;
  policy: { k: number; n: number };
  agreement: number;
  conflict: boolean;
}> = ({ satisfied, policy, agreement, conflict }) => {
  if (satisfied && !conflict) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-quorum-green-bg/80 border border-quorum-green-border text-quorum-green-light text-xs font-medium">
        <Check className="w-4 h-4 text-quorum-green flex-shrink-0" />
        <span>
          <strong>{policy.k}-of-{policy.n} Quorum Reached</strong> — All {agreement} builders in consensus
        </span>
      </div>
    );
  }

  if (satisfied && conflict) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-quorum-amber-bg/80 border border-quorum-amber-border text-quorum-amber-light text-xs font-medium">
        <AlertTriangle className="w-4 h-4 text-quorum-amber flex-shrink-0" />
        <span>
          <strong>{policy.k}-of-{policy.n} Quorum Reached</strong> — Majority agreement ({agreement}/{policy.n}), 1 conflict isolated
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-quorum-red-bg/80 border border-quorum-red-border text-quorum-red-light text-xs font-medium">
      <X className="w-4 h-4 text-quorum-red flex-shrink-0" />
      <span>
        <strong>{policy.k}-of-{policy.n} Quorum Failed</strong> — Required {policy.k} matching builders, only {agreement} matched
      </span>
    </div>
  );
};
