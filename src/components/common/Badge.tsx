import React from 'react';
import { cn } from '../../lib/utils';
import { VerificationDecision, BuilderStatus, AttestationStatus } from '../../types';

interface BadgeProps {
  variant?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'slate';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'slate',
  size = 'md',
  dot = false,
  pulse = false,
  className,
  children,
}) => {
  const variantStyles = {
    green: 'bg-quorum-green-bg/80 text-quorum-green-light border-quorum-green-border',
    red: 'bg-quorum-red-bg/80 text-quorum-red-light border-quorum-red-border',
    amber: 'bg-quorum-amber-bg/80 text-quorum-amber-light border-quorum-amber-border',
    blue: 'bg-quorum-blue-bg/80 text-quorum-blue-light border-quorum-blue-border',
    purple: 'bg-purple-950/70 text-purple-300 border-purple-800/60',
    slate: 'bg-brand-panel text-brand-muted border-brand-border',
  };

  const dotColors = {
    green: 'bg-quorum-green',
    red: 'bg-quorum-red',
    amber: 'bg-quorum-amber',
    blue: 'bg-quorum-blue',
    purple: 'bg-purple-400',
    slate: 'bg-brand-muted',
  };

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 font-medium tracking-wide',
    md: 'text-xs px-2.5 py-1 font-medium',
    lg: 'text-sm px-3.5 py-1.5 font-semibold',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border transition-colors',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            dotColors[variant],
            pulse && 'animate-pulse'
          )}
        />
      )}
      {children}
    </span>
  );
};

export const DecisionBadge: React.FC<{ decision: VerificationDecision; size?: 'sm' | 'md' | 'lg' }> = ({
  decision,
  size = 'md',
}) => {
  switch (decision) {
    case 'ACCEPTED':
      return (
        <Badge variant="green" size={size} dot pulse>
          VERIFIED
        </Badge>
      );
    case 'REJECTED':
      return (
        <Badge variant="red" size={size} dot>
          REJECTED
        </Badge>
      );
    case 'CONFLICT':
      return (
        <Badge variant="amber" size={size} dot pulse>
          CONFLICT
        </Badge>
      );
    default:
      return (
        <Badge variant="slate" size={size} dot>
          PENDING
        </Badge>
      );
  }
};

export const BuilderStatusBadge: React.FC<{ status: BuilderStatus }> = ({ status }) => {
  switch (status) {
    case 'ATTESTED':
      return (
        <Badge variant="green" size="sm" dot>
          ATTESTED
        </Badge>
      );
    case 'APPROVED':
      return (
        <Badge variant="green" size="sm" dot>
          APPROVED
        </Badge>
      );
    case 'COMPROMISED':
      return (
        <Badge variant="red" size="sm" dot>
          COMPROMISED
        </Badge>
      );
    case 'PENDING_APPROVAL':
      return (
        <Badge variant="amber" size="sm" dot>
          PENDING APPROVAL
        </Badge>
      );
    case 'REGISTERED':
      return (
        <Badge variant="slate" size="sm" dot>
          REGISTERED
        </Badge>
      );
  }
};

export const AttestationStatusBadge: React.FC<{ status: AttestationStatus }> = ({ status }) => {
  switch (status) {
    case 'MATCH':
      return (
        <Badge variant="green" size="sm">
          MATCH
        </Badge>
      );
    case 'CONFLICT':
      return (
        <Badge variant="amber" size="sm">
          CONFLICT
        </Badge>
      );
    case 'INVALID_SIG':
      return (
        <Badge variant="red" size="sm">
          INVALID SIG
        </Badge>
      );
    default:
      return (
        <Badge variant="slate" size="sm">
          PENDING
        </Badge>
      );
  }
};
