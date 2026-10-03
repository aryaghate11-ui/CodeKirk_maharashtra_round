import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Attestation } from '../../types';
import { CopyButton } from '../common/CopyButton';
import { truncateAddress, truncateHash } from '../../lib/utils';
import { AttestationStatusBadge } from '../common/Badge';

interface BuilderEvidenceTableProps {
  attestations: Attestation[];
  consensusHash: string | null;
  conflictDetected: boolean;
}

export const BuilderEvidenceTable: React.FC<BuilderEvidenceTableProps> = ({
  attestations,
  consensusHash,
  conflictDetected,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-brand-border/70 text-brand-muted uppercase tracking-wider text-[11px] bg-brand-panel-elevated/40">
            <th className="py-3 px-4 font-semibold">Builder & Node</th>
            <th className="py-3 px-4 font-semibold">Operator Address</th>
            <th className="py-3 px-4 font-semibold">Reproduced Artifact Hash (SHA-256)</th>
            <th className="py-3 px-4 font-semibold">ECDSA Signature</th>
            <th className="py-3 px-4 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border/50">
          {attestations.map((att, idx) => {
            const isMatch = att.artifactHash === consensusHash && att.signatureValid;
            const isConflict = att.signatureValid && att.artifactHash !== consensusHash;
            const isInvalidSig = !att.signatureValid;

            return (
              <tr
                key={att.id || idx}
                className={`transition-colors duration-150 ${
                  isConflict
                    ? 'bg-quorum-amber-bg/30 hover:bg-quorum-amber-bg/40 border-l-2 border-l-quorum-amber'
                    : isInvalidSig
                    ? 'bg-quorum-red-bg/30 hover:bg-quorum-red-bg/40 border-l-2 border-l-quorum-red'
                    : 'hover:bg-brand-panel-elevated/40'
                }`}
              >
                {/* Builder Info */}
                <td className="py-3.5 px-4 min-w-[200px]">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg grid place-items-center font-mono text-xs font-bold border ${
                        isConflict
                          ? 'bg-quorum-amber-bg border-quorum-amber-border text-quorum-amber'
                          : isInvalidSig
                          ? 'bg-quorum-red-bg border-quorum-red-border text-quorum-red'
                          : 'bg-brand-panel-elevated border-brand-border text-brand-text'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div>
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span>{att.builderName}</span>
                        {isConflict && (
                          <span
                            title="Conflicting artifact produced"
                            className="inline-flex items-center gap-0.5 text-[10px] text-quorum-amber font-mono px-1 py-0.2 rounded bg-quorum-amber-bg border border-quorum-amber-border"
                          >
                            <AlertTriangle className="w-2.5 h-2.5" /> DIVERGENT
                          </span>
                        )}
                        {isInvalidSig && (
                          <span
                            title="Cryptographic signature invalid"
                            className="inline-flex items-center gap-0.5 text-[10px] text-quorum-red font-mono px-1 py-0.2 rounded bg-quorum-red-bg border border-quorum-red-border"
                          >
                            <ShieldAlert className="w-2.5 h-2.5" /> UNTRUSTED
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-brand-muted truncate max-w-[220px]">
                        {att.environment}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Operator Address */}
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1">
                    <span
                      className="font-mono text-brand-muted text-[11px] hover:text-brand-text"
                      title={att.builderAddress}
                    >
                      {truncateAddress(att.builderAddress, 6, 4)}
                    </span>
                    <CopyButton text={att.builderAddress} title="Copy operator address" />
                  </div>
                </td>

                {/* Artifact Hash */}
                <td className="py-3.5 px-4 min-w-[260px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-mono text-[11px] font-medium tracking-tight ${
                        isConflict
                          ? 'text-quorum-amber line-through decoration-quorum-amber/50 font-semibold'
                          : isInvalidSig
                          ? 'text-quorum-red'
                          : 'text-quorum-green-light'
                      }`}
                      title={att.artifactHash}
                    >
                      {truncateHash(att.artifactHash, 10, 8)}
                    </span>
                    <CopyButton text={att.artifactHash} title="Copy artifact SHA-256" />
                  </div>
                  {isConflict && (
                    <p className="text-[10px] text-quorum-amber-light font-mono mt-0.5">
                      Diverges from consensus hash
                    </p>
                  )}
                </td>

                {/* Signature */}
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5">
                    {att.signatureValid ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-quorum-green">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        VALID
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-quorum-red font-semibold">
                        <XCircle className="w-3.5 h-3.5" />
                        INVALID
                      </span>
                    )}
                    <span
                      className="font-mono text-[10px] text-brand-subtle hidden xl:inline"
                      title={att.signature}
                    >
                      ({truncateHash(att.signature, 4, 3)})
                    </span>
                    <CopyButton text={att.signature} title="Copy ECDSA signature" />
                  </div>
                </td>

                {/* Status Badge */}
                <td className="py-3.5 px-4 text-right">
                  <AttestationStatusBadge status={att.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {conflictDetected && (
        <div className="p-3 bg-quorum-amber-bg/40 border-t border-quorum-amber-border/60 flex items-center justify-between text-xs text-quorum-amber-light">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-quorum-amber flex-shrink-0" />
            <span>
              <strong>Conflict Detected:</strong> 1 builder produced a diverging artifact hash. Quorum policy evaluation isolates the anomaly.
            </span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-quorum-amber">
            Majority: 2 · Conflicting: 1
          </span>
        </div>
      )}
    </div>
  );
};
