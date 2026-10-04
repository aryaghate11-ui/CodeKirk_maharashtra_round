import React from 'react';
import { Builder } from '../../types';
import { Card } from '../common/Card';
import { BuilderStatusBadge } from '../common/Badge';
import { CopyButton } from '../common/CopyButton';
import { truncateAddress, truncateHash, formatRelativeTime } from '../../lib/utils';
import {
  Server,
  KeyRound,
  Cpu,
  Clock,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';

interface BuilderCardProps {
  builder: Builder;
  index: number;
}

export const BuilderCard: React.FC<BuilderCardProps> = ({ builder, index }) => {
  return (
    <Card className="hover:border-brand-border-bright transition-all duration-200">
      <div className="p-5 space-y-4">
        {/* Card Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-panel-elevated/80 backdrop-blur-sm border border-brand-border grid place-items-center font-mono text-sm font-bold text-quorum-green">
              {builder.shortCode}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white tracking-tight">
                  {builder.name}
                </h4>
                <span className="text-[10px] font-mono text-brand-subtle">
                  Node #{String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="text-xs text-brand-muted truncate max-w-[200px]">
                {builder.operator}
              </p>
            </div>
          </div>

          <BuilderStatusBadge status={builder.status} />
        </div>

        {/* Technical Specs Matrix */}
        <div className="space-y-2 pt-1 text-xs">
          {/* Public Key */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/60">
            <span className="text-brand-muted flex items-center gap-1.5 text-[11px]">
              <KeyRound className="w-3 h-3 text-brand-subtle" />
              Public Key (Ed25519)
            </span>
            <div className="flex items-center gap-1 font-mono text-[11px] text-white">
              <span>{truncateAddress(builder.address, 8, 6)}</span>
              <CopyButton text={builder.address} title="Copy builder public key" />
            </div>
          </div>

          {/* Sandbox Runtime / Environment */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/60">
            <span className="text-brand-muted flex items-center gap-1.5 text-[11px]">
              <Cpu className="w-3 h-3 text-brand-subtle" />
              Platform / Sandbox
            </span>
            <span className="font-mono text-[11px] text-brand-text truncate max-w-[210px]" title={builder.environment}>
              {builder.environment}
            </span>
          </div>

          {/* Last Artifact Hash */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/60">
            <span className="text-brand-muted flex items-center gap-1.5 text-[11px]">
              <ShieldCheck className="w-3 h-3 text-brand-subtle" />
              Latest Artifact SHA-256
            </span>
            <div className="flex items-center gap-1 font-mono text-[11px] text-quorum-green-light">
              <span>{truncateHash(builder.lastArtifactHash, 7, 5)}</span>
              <CopyButton text={builder.lastArtifactHash} title="Copy latest artifact hash" />
            </div>
          </div>
        </div>

        {/* Footer Metrics */}
        <div className="pt-3 border-t border-brand-border/60 flex items-center justify-between text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-brand-muted">
            <Clock className="w-3 h-3 text-brand-subtle" />
            <span>Latest build:</span>
            <span className="text-white">{formatRelativeTime(builder.latestAttestationTime)}</span>
          </div>

          <div className={`flex items-center gap-1 ${builder.trusted ? 'text-quorum-green' : 'text-quorum-amber'}`}>
            {builder.trusted ? <CheckCircle2 className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
            <span>{builder.trusted ? 'Trust: APPROVED' : 'Trust: PENDING'}</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
