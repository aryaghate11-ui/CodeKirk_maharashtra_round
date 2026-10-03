import React from 'react';
import { AuditEvent } from '../../types';
import {
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Send,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { formatRelativeTime } from '../../lib/utils';

interface ActivityTimelineProps {
  events: AuditEvent[];
  maxEvents?: number;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  events,
  maxEvents = 6,
}) => {
  const displayEvents = events.slice(0, maxEvents);

  const getEventIcon = (type: AuditEvent['type']) => {
    switch (type) {
      case 'AUDIT_SEALED':
        return <Lock className="w-3.5 h-3.5 text-quorum-green" />;
      case 'DECISION_FINALIZED':
        return <ShieldCheck className="w-3.5 h-3.5 text-quorum-green" />;
      case 'CONFLICT_DETECTED':
        return <AlertTriangle className="w-3.5 h-3.5 text-quorum-amber" />;
      case 'SIGNATURE_VERIFIED':
        return <CheckCircle2 className="w-3.5 h-3.5 text-quorum-blue-light" />;
      case 'ATTESTATION_SUBMITTED':
        return <Send className="w-3.5 h-3.5 text-brand-muted" />;
      default:
        return <FileCheck className="w-3.5 h-3.5 text-brand-subtle" />;
    }
  };

  return (
    <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1px] before:bg-brand-border">
      {displayEvents.map((evt) => {
        const isConflict = evt.type === 'CONFLICT_DETECTED';
        const isSuccess = evt.type === 'DECISION_FINALIZED' || evt.type === 'AUDIT_SEALED';

        return (
          <div key={evt.id} className="relative group">
            {/* Dot marker */}
            <div
              className={`absolute -left-6 top-1 w-5 h-5 rounded-full grid place-items-center border bg-brand-panel/85 backdrop-blur-sm ${
                isSuccess
                  ? 'border-quorum-green-border text-quorum-green'
                  : isConflict
                  ? 'border-quorum-amber-border text-quorum-amber'
                  : 'border-brand-border text-brand-muted'
              }`}
            >
              {getEventIcon(evt.type)}
            </div>

            {/* Event detail */}
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white tracking-tight">
                  {evt.title}
                </span>
                <span className="text-[10px] font-mono text-brand-subtle">
                  {formatRelativeTime(evt.timestamp)}
                </span>
              </div>
              <p className="text-xs text-brand-muted leading-relaxed line-clamp-2">
                {evt.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
