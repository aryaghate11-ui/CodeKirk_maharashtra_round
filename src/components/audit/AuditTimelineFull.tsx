import React from 'react';
import { AuditEvent } from '../../types';
import {
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Send,
  Lock,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { CopyButton } from '../common/CopyButton';
import { truncateHash } from '../../lib/utils';

interface AuditTimelineFullProps {
  events: AuditEvent[];
}

export const AuditTimelineFull: React.FC<AuditTimelineFullProps> = ({ events }) => {
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

  return (
    <div className="relative pl-8 space-y-6 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-[1px] before:bg-brand-border">
      {events.map((evt) => {
        const isConflict = evt.type === 'CONFLICT_DETECTED';
        const isSealed = evt.type === 'AUDIT_SEALED';
        const isFinal = evt.type === 'DECISION_FINALIZED';

        return (
          <div key={evt.id} className="relative group">
            {/* Event circular anchor */}
            <div
              className={`absolute -left-8 top-1.5 w-6 h-6 rounded-full grid place-items-center border bg-brand-panel ${
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
              className={`p-4 rounded-xl border transition-all duration-150 ${
                isConflict
                  ? 'bg-quorum-amber-bg/25 border-quorum-amber-border/70'
                  : isSealed
                  ? 'bg-quorum-green-bg/25 border-quorum-green-border/70'
                  : 'bg-brand-panel/60 border-brand-border hover:bg-brand-panel-elevated/40'
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

                {evt.blockNumber && (
                  <span className="font-mono text-[11px] text-brand-subtle flex items-center gap-1">
                    Block #{evt.blockNumber}
                  </span>
                )}
              </div>

              <p className="text-xs text-brand-muted leading-relaxed">
                {evt.description}
              </p>

              {/* Hash / Transaction Footnotes if present */}
              {(evt.txHash || evt.evidenceHash) && (
                <div className="mt-3 pt-2.5 border-t border-brand-border/40 flex flex-wrap items-center gap-4 text-[11px] font-mono">
                  {evt.txHash && (
                    <div className="flex items-center gap-1 text-brand-muted">
                      <span className="text-brand-subtle">Tx:</span>
                      <span className="text-brand-text">{truncateHash(evt.txHash, 8, 6)}</span>
                      <CopyButton text={evt.txHash} title="Copy transaction hash" />
                    </div>
                  )}

                  {evt.evidenceHash && (
                    <div className="flex items-center gap-1 text-brand-muted">
                      <span className="text-brand-subtle">Evidence Root:</span>
                      <span className="text-quorum-green-light font-mono">
                        {truncateHash(evt.evidenceHash, 8, 6)}
                      </span>
                      <CopyButton text={evt.evidenceHash} title="Copy evidence hash" />
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
