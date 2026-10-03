import React, { useState } from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { AuditReport } from '../../types';
import { CopyButton } from '../common/CopyButton';
import { truncateHash, downloadJsonFile } from '../../lib/utils';
import { DecisionBadge } from '../common/Badge';
import {
  Download,
  ShieldCheck,
  Check,
  Code2,
  Database,
  Layers,
  Scale,
} from 'lucide-react';

interface AuditMetadataCardProps {
  report: AuditReport;
}

export const AuditMetadataCard: React.FC<AuditMetadataCardProps> = ({ report }) => {
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownload = () => {
    downloadJsonFile(`quorum-audit-${report.releaseId}.json`, report);
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  return (
    <Card className="border-brand-border-bright/80 h-full flex flex-col justify-between">
      <div>
        <CardHeader
          title="Audit Chain Summary"
          subtitle="Hash-linked provenance records stored in local SQLite"
          icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />}
          badge={
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-bg-deep/70 backdrop-blur-sm border border-brand-border text-quorum-green-light">
              Hash Chain Sealed
            </span>
          }
        />

        <CardBody className="space-y-4">
          <div className="space-y-2.5 text-xs">
            {/* Chain Head */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Audit Chain Head (Latest Event Hash)
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-quorum-green-light break-all">
                  {report.evidenceHash || '0'.repeat(64)}
                </span>
                <CopyButton text={report.evidenceHash} title="Copy chain head hash" />
              </div>
            </div>

            {/* Target Package & Release */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Target Package & Version
              </span>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">
                  {report.repo}
                </span>
                <DecisionBadge decision={report.decision} size="sm" />
              </div>
            </div>

            {/* Consensus Artifact Hash */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Consensus Artifact SHA-256
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-brand-text truncate max-w-[210px]">
                  {report.consensusHash ? truncateHash(report.consensusHash, 10, 8) : 'No Consensus'}
                </span>
                {report.consensusHash && (
                  <CopyButton text={report.consensusHash} title="Copy consensus hash" />
                )}
              </div>
            </div>

            {/* Verification Engine & Storage */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border">
                <span className="text-[10px] font-mono text-brand-muted uppercase block flex items-center gap-1">
                  <Database className="w-3 h-3 text-brand-subtle" />
                  Storage
                </span>
                <span className="font-mono text-xs font-semibold text-white">
                  SQLite Hash Chain
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border">
                <span className="text-[10px] font-mono text-brand-muted uppercase block flex items-center gap-1">
                  <Scale className="w-3 h-3 text-brand-subtle" />
                  Policy
                </span>
                <span className="font-mono text-xs font-semibold text-quorum-green-light">
                  {report.policy.k}-of-{report.policy.n} Quorum
                </span>
              </div>
            </div>
          </div>
        </CardBody>
      </div>

      {/* Download Action Area */}
      <div className="p-4 border-t border-brand-border/70 bg-brand-panel-elevated/30 backdrop-blur-sm space-y-2">
        <button
          onClick={handleDownload}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-sans text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light transition-all shadow-glow-green cursor-pointer"
        >
          {downloadSuccess ? (
            <>
              <Check className="w-4 h-4 text-black stroke-[3]" />
              <span>Downloaded audit-report.json</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 text-black" />
              <span>Download audit-report.json</span>
            </>
          )}
        </button>

        <button
          onClick={() => setShowJsonPreview(!showJsonPreview)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-brand-muted hover:text-white transition-colors font-mono cursor-pointer"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>{showJsonPreview ? 'Hide Raw Audit JSON' : 'Inspect Raw Audit JSON'}</span>
        </button>

        {showJsonPreview && (
          <div className="p-3 mt-2 rounded-lg bg-brand-bg-deep/80 backdrop-blur-sm border border-brand-border overflow-auto max-h-56 text-[10px] font-mono text-slate-300">
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </div>
        )}
      </div>
    </Card>
  );
};
