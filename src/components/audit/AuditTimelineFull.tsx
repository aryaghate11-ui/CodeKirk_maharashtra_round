import React, { useState } from 'react';
import { AuditEvent } from '../../types';
import {
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Send,
  Lock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Hash,
} from 'lucide-react';
import { CopyButton } from '../common/CopyButton';
import { truncateHash } from '../../lib/utils';

interface AuditTimelineFullProps {
  events: AuditEvent[];
}

export const AuditTimelineFull: React.FC<AuditTimelineFullProps> = ({ events }) => {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const getEventIcon = (type: AuditEvent['type']) => {
    switch (type) {
      case 'AUDIT_SEALED':
        return <Lock className="w-4 h-4 text-quorum-green" />;
      case 'DECISION_FINALIZED':
        return <ShieldCheck className="w-4 h-4 text-quorum-green" />;
      case 'CONFLICT_DETECTED':
        return <AlertTriangle className="w-4 h-4 text-quorum-amber" />;
      case 'SIGNATURE_VERIFIED':
        return <CheckCircle2 className="w-4 h-4 text-quorum-blue-light" />;
      case 'ATTESTATION_SUBMITTED':
        return <Send className="w-4 h-4 text-brand-muted" />;
      default:
        return <FileCheck className="w-4 h-4 text-brand-subtle" />;
    }
  };

  if (events.length === 0) {
    return (
      <div className="p-8 text-center text-xs font-mono text-brand-muted">
        No audit events recorded for this release yet.
      </div>
    );
  }

  return (
    <div className="relative pl-8 space-y-5 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-[1px] before:bg-brand-border">
      {events.map((evt, idx) => {
        const isConflict = evt.type === 'CONFLICT_DETECTED';
        const isSealed = evt.type === 'AUDIT_SEALED';
        const isFinal = evt.type === 'DECISION_FINALIZED';
        const isExpanded = expandedEventId === evt.id;

        return (
          <div key={evt.id || idx} className="relative group">
            {/* Event circular anchor */}
            <div
              className={`absolute -left-8 top-1.5 w-6 h-6 rounded-full grid place-items-center border bg-brand-panel/85 backdrop-blur-sm ${
                isSealed || isFinal
                  ? 'border-quorum-green-border text-quorum-green shadow-glow-green'
                  : isConflict
                  ? 'border-quorum-amber-border text-quorum-amber shadow-glow-amber'
                  : 'border-brand-border text-brand-muted'
              }`}
            >
              {getEventIcon(evt.type)}
            </div>

            {/* Event Content Card */}
            <div
              className={`p-4 rounded-xl border backdrop-blur-md transition-all duration-150 ${
                isConflict
                  ? 'bg-quorum-amber-bg/25 border-quorum-amber-border/70'
                  : isSealed || isFinal
                  ? 'bg-quorum-green-bg/20 border-quorum-green-border/70'
                  : 'bg-brand-panel/70 border-brand-border hover:bg-brand-panel-elevated/50'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-quorum-green-light font-bold">
                    {evt.timeFormatted}
                  </span>
                  <span className="text-white font-semibold text-sm">
                    {evt.title}
                  </span>
                </div>

                <span className="font-mono text-[11px] text-brand-subtle">
                  Step #{idx + 1}
                </span>
              </div>

              <p className="text-xs text-brand-muted leading-relaxed">
                {evt.description}
              </p>

              {/* Collapsible cryptographic details */}
              {evt.evidenceHash && (
                <div className="mt-3 pt-2.5 border-t border-brand-border/40">
                  <button
                    onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                    className="flex items-center gap-1.5 text-[11px] font-mono text-brand-muted hover:text-white transition-colors cursor-pointer"
                  >
                    <Hash className="w-3 h-3 text-brand-subtle" />
                    <span>{isExpanded ? 'Hide Event Hash Details' : 'Show Event Hash Details'}</span>
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-2 p-2.5 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-1 text-[11px] font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-brand-subtle">Event Hash:</span>
                        <div className="flex items-center gap-1 text-quorum-green-light">
                          <span>{truncateHash(evt.evidenceHash, 14, 10)}</span>
                          <CopyButton text={evt.evidenceHash} title="Copy event hash" />
                        </div>
                      </div>
                      <div className="text-[10px] text-brand-subtle pt-1">
                        Sealed into local SQLite hash-chain ledger.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
