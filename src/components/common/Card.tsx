import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  className?: string;
  glow?: 'green' | 'red' | 'amber' | 'blue' | 'none';
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  className,
  glow = 'none',
  children,
}) => {
  const glowStyles = {
    none: '',
    green: 'border-quorum-green-border/60 shadow-glow-green',
    red: 'border-quorum-red-border/60 shadow-glow-red',
    amber: 'border-quorum-amber-border/60 shadow-glow-amber',
    blue: 'border-quorum-blue-border/60',
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-brand-border/70 bg-brand-panel/75 backdrop-blur-md shadow-panel transition-all duration-200 overflow-hidden',
        glowStyles[glow],
        className
      )}
    >
      {children}
    </div>
  );
};

interface CardHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  icon,
  badge,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'px-5 py-4 border-b border-brand-border/60 bg-brand-panel-elevated/25 flex items-center justify-between gap-3',
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <div className="text-brand-muted flex-shrink-0">{icon}</div>}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-text tracking-tight truncate">
              {title}
            </h3>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs text-brand-muted mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
};

export const CardBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  return <div className={cn('p-5', className)}>{children}</div>;
};
