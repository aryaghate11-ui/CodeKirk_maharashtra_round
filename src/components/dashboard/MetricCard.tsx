import React from 'react';
import { Card } from '../common/Card';
import { cn } from '../../lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  trend?: string;
  variant?: 'green' | 'red' | 'amber' | 'blue' | 'default';
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subtext,
  icon,
  trend,
  variant = 'default',
}) => {
  const borderStyles = {
    green: 'hover:border-quorum-green-border/80',
    red: 'hover:border-quorum-red-border/80',
    amber: 'hover:border-quorum-amber-border/80',
    blue: 'hover:border-quorum-blue-border/80',
    default: 'hover:border-brand-border-bright',
  };

  const valueColors = {
    green: 'text-quorum-green-light',
    red: 'text-quorum-red-light',
    amber: 'text-quorum-amber-light',
    blue: 'text-quorum-blue-light',
    default: 'text-white',
  };

  return (
    <Card className={cn('p-5 transition-all group', borderStyles[variant])}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider block">
            {label}
          </span>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-3xl font-extrabold font-mono tracking-tight', valueColors[variant])}>
              {value}
            </span>
            {trend && (
              <span className="text-[11px] font-mono text-quorum-green-light font-medium">
                {trend}
              </span>
            )}
          </div>
          {subtext && (
            <p className="text-xs text-brand-subtle pt-0.5">{subtext}</p>
          )}
        </div>

        <div className="p-2.5 rounded-xl bg-brand-panel-elevated/70 border border-brand-border text-brand-muted group-hover:text-white transition-colors">
          {icon}
        </div>
      </div>
    </Card>
  );
};
