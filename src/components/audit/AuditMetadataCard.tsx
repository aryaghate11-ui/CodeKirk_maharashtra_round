import React, { useState } from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { AuditReport } from '../../types';
import { CopyButton } from '../common/CopyButton';
import { truncateHash, downloadJsonFile } from '../../lib/utils';
import {
  Download,
  ShieldCheck,
  Check,
  Code2,
  Link,
  Loader2,
} from 'lucide-react';

interface AuditMetadataCardProps {
  report: AuditReport;
  onAnchor?: () => void;
  anchoring?: boolean;
  anchorError?: string | null;
}

export const AuditMetadataCard: React.FC<AuditMetadataCardProps> = ({
  report,
  onAnchor,
  anchoring = false,
  anchorError,
}) => {
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownload = () => {
    downloadJsonFile(
      `quorum-audit-${report.releaseId}.json`,
      report.rawReport || report
    );
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  return (
    <Card className="border-brand-border-bright/80 h-full flex flex-col justify-between">
      <div>
        <CardHeader
          title="Audit Ledger Metadata"
          subtitle="Portable evidence snapshot with optional Anvil anchoring"
          icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />}
          badge={
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-quorum-green-light">
              {report.anchored ? (report.onChainMatch ? 'Anchor matched' : 'Anchor not confirmed') : 'Not anchored'}
            </span>
          }
        />

        <CardBody className="space-y-4">
          <p className="text-xs text-brand-muted">A signed evidence snapshot. Anvil is a local development chain, not a public immutable network. Offline trust requires a separately obtained signing key.</p>
          <div className="space-y-2.5 text-xs">
            {/* Evidence Hash */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Evidence Snapshot SHA-256
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-quorum-green-light break-all">
                  {report.evidenceHash}
                </span>
                <CopyButton text={report.evidenceHash} title="Copy evidence hash" />
              </div>
            </div>

            {/* Policy Hash */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Quorum Policy Hash
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-brand-text break-all">
                  {report.policyHash}
                </span>
                <CopyButton text={report.policyHash} title="Copy policy hash" />
              </div>
            </div>

            {/* Contract Address */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Verification Contract Address
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-brand-text">
                  {report.contractAddress}
                </span>
                <CopyButton text={report.contractAddress} title="Copy contract address" />
              </div>
            </div>

            {/* Transaction Hash */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/70 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Settlement Transaction Hash
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-brand-text">
                  {report.transactionHash ? truncateHash(report.transactionHash, 14, 12) : 'Not anchored'}
                </span>
                <CopyButton text={report.transactionHash} title="Copy tx hash" />
              </div>
            </div>

            {/* Block & Gas Specs */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
                <span className="text-[10px] font-mono text-brand-muted uppercase block">
                  Block Height
                </span>
                <span className="font-mono text-xs font-semibold text-white">
                  {report.blockNumber ? `#${report.blockNumber.toLocaleString()}` : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
                <span className="text-[10px] font-mono text-brand-muted uppercase block">
                  Gas Consumption
                </span>
                <span className="font-mono text-xs font-semibold text-brand-muted">
                  {report.gasUsed}
                </span>
              </div>
            </div>
          </div>
        </CardBody>
      </div>

      {/* Download Action Area */}
      <div className="p-4 border-t border-brand-border/70 bg-brand-panel-elevated/20 space-y-2">
        {!report.anchored && onAnchor && (
          <button
            onClick={onAnchor}
            disabled={anchoring}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-sans text-xs font-bold text-quorum-green-light bg-quorum-green-bg border border-quorum-green-border hover:bg-quorum-green/15 disabled:opacity-60 transition-all"
          >
            {anchoring ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link className="w-4 h-4" />
            )}
            <span>{anchoring ? 'Anchoring evidence…' : 'Anchor evidence on Anvil'}</span>
          </button>
        )}

        {anchorError && (
          <p className="text-[11px] leading-relaxed text-red-300 bg-red-950/30 border border-red-900/60 rounded-lg p-2.5">
            {anchorError}
          </p>
        )}

        <button
          onClick={handleDownload}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-sans text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light transition-all shadow-glow-green"
        >
          {downloadSuccess ? (
            <>
              <Check className="w-4 h-4 text-black stroke-[3]" />
              <span>Downloaded audit-report.json</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 text-black" />
              <span>Download verifiable audit-report.json</span>
            </>
          )}
        </button>

        <button
          onClick={() => setShowJsonPreview(!showJsonPreview)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-brand-muted hover:text-white transition-colors font-mono"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>{showJsonPreview ? 'Hide Raw Audit JSON' : 'Inspect Raw Audit JSON'}</span>
        </button>

        {showJsonPreview && (
          <div className="p-3 mt-2 rounded-lg bg-brand-bg-deep border border-brand-border overflow-auto max-h-48 text-[10px] font-mono text-slate-300">
            <pre>{JSON.stringify(report.rawReport || report, null, 2)}</pre>
          </div>
        )}
      </div>
    </Card>
  );
};
