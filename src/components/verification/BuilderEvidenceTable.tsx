import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Copy, Hash, Layers } from 'lucide-react';
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
    <div className="space-y-3">
      {/* Consensus Reference Banner */}
      <div className="p-3.5 rounded-xl bg-brand-bg-deep/75 backdrop-blur-md border border-brand-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-brand-panel-elevated/80 border border-brand-border/70 text-quorum-green">
            <Hash className="w-3.5 h-3.5" />
          </div>
          <span className="font-mono text-brand-muted text-[11px] uppercase tracking-wider">
            Consensus Baseline SHA-256:
          </span>
          {consensusHash ? (
            <div className="flex items-center gap-1.5 font-mono font-bold text-quorum-green-light text-[11px] bg-quorum-green-bg/50 px-2 py-0.5 rounded border border-quorum-green-border/60 backdrop-blur-sm">
              <span>{truncateHash(consensusHash, 14, 10)}</span>
              <CopyButton text={consensusHash} title="Copy full consensus SHA-256 hash" />
            </div>
          ) : (
            <span className="font-mono text-quorum-amber text-[11px]">
              No consensus established
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-brand-subtle">Witness Parity:</span>
          <span className={`px-2 py-0.5 rounded border font-semibold backdrop-blur-sm ${
            conflictDetected
              ? 'bg-quorum-amber-bg/80 text-quorum-amber-light border-quorum-amber-border/80'
              : 'bg-quorum-green-bg/80 text-quorum-green-light border-quorum-green-border/80'
          }`}>
            {conflictDetected ? 'DIVERGENCE DETECTED' : 'UNANIMOUS MATCH'}
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-xl border border-brand-border/70 shadow-panel backdrop-blur-sm">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-brand-border/60 text-brand-muted uppercase tracking-wider text-[11px] bg-brand-panel-elevated/40">
              <th className="py-3 px-4 font-semibold">Builder & Node</th>
              <th className="py-3 px-4 font-semibold">Operator / Public Key</th>
              <th className="py-3 px-4 font-semibold">Reproduced Artifact Hash (SHA-256)</th>
              <th className="py-3 px-4 font-semibold">Ed25519 Signature</th>
              <th className="py-3 px-4 font-semibold text-right">Consensus Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/50 bg-brand-panel/30">
            {attestations.map((att, idx) => {
              const isPending = att.status === 'PENDING' || !att.artifactHash;
              const isMatch = !isPending && att.artifactHash === consensusHash && att.signatureValid;
              const isConflict = !isPending && att.signatureValid && att.artifactHash !== consensusHash;
              const isInvalidSig = !isPending && !att.signatureValid;

              return (
                <tr
                  key={att.id || idx}
                  className={`transition-colors duration-150 ${
                    isPending
                      ? 'bg-brand-panel/20 hover:bg-brand-panel-elevated/30 border-l-4 border-l-quorum-amber'
                      : isConflict
                      ? 'bg-quorum-amber-bg/25 hover:bg-quorum-amber-bg/35 border-l-4 border-l-quorum-amber'
                      : isInvalidSig
                      ? 'bg-quorum-red-bg/25 hover:bg-quorum-red-bg/35 border-l-4 border-l-quorum-red'
                      : 'hover:bg-brand-panel-elevated/40 border-l-4 border-l-quorum-green'
                  }`}
                >
                  {/* Builder Info */}
                  <td className="py-3.5 px-4 min-w-[200px]">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-lg grid place-items-center font-mono text-xs font-bold border ${
                          isPending
                            ? 'bg-quorum-amber-bg/60 border-quorum-amber-border/60 text-quorum-amber'
                            : isConflict
                            ? 'bg-quorum-amber-bg border-quorum-amber-border text-quorum-amber'
                            : isInvalidSig
                            ? 'bg-quorum-red-bg border-quorum-red-border text-quorum-red'
                            : 'bg-brand-panel-elevated border-brand-border text-quorum-green-light'
                        }`}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          <span>{att.builderName}</span>
                          {isPending && (
                            <span
                              title="Awaiting builder attestation"
                              className="inline-flex items-center gap-0.5 text-[10px] text-quorum-amber font-mono px-1.5 py-0.2 rounded bg-quorum-amber-bg border border-quorum-amber-border font-bold"
                            >
                              PENDING
                            </span>
                          )}
                          {isConflict && (
                            <span
                              title="Conflicting artifact digest produced"
                              className="inline-flex items-center gap-0.5 text-[10px] text-quorum-amber font-mono px-1.5 py-0.2 rounded bg-quorum-amber-bg border border-quorum-amber-border font-bold"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" /> DIVERGENT
                            </span>
                          )}
                          {isInvalidSig && (
                            <span
                              title="Cryptographic signature invalid"
                              className="inline-flex items-center gap-0.5 text-[10px] text-quorum-red font-mono px-1.5 py-0.2 rounded bg-quorum-red-bg border border-quorum-red-border font-bold"
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

                  {/* Operator Public Key */}
                  <td className="py-3.5 px-4 min-w-[150px]">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1 font-mono text-[11px] text-brand-text">
                        <span title={att.builderAddress}>
                          {truncateAddress(att.builderAddress, 6, 4)}
                        </span>
                        {att.builderAddress !== 'Pending key' && <CopyButton text={att.builderAddress} title="Copy builder public key" />}
                      </div>
                      <span className="text-[10px] font-mono text-brand-subtle block">
                        {isPending ? 'Key registered' : 'Ed25519 identity verified'}
                      </span>
                    </div>
                  </td>

                  {/* Artifact Hash Comparison */}
                  <td className="py-3.5 px-4 min-w-[280px]">
                    <div className="space-y-1">
                      {isPending ? (
                        <span className="font-mono text-[11px] text-brand-subtle italic">Awaiting signed evidence…</span>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-[11px] font-semibold tracking-tight px-1.5 py-0.5 rounded ${
                                isConflict
                                  ? 'text-quorum-amber bg-quorum-amber-bg/60 border border-quorum-amber-border line-through decoration-quorum-amber'
                                  : isInvalidSig
                                  ? 'text-quorum-red bg-quorum-red-bg/60 border border-quorum-red-border'
                                  : 'text-quorum-green-light bg-quorum-green-bg/40 border border-quorum-green-border/50'
                              }`}
                              title={`Full SHA-256: ${att.artifactHash}`}
                            >
                              {truncateHash(att.artifactHash, 12, 10)}
                            </span>
                            <CopyButton text={att.artifactHash} title="Copy artifact SHA-256" />
                          </div>
                          {isConflict ? (
                            <p className="text-[10px] text-quorum-amber-light font-mono flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-quorum-amber" />
                              <span>Diverges from consensus hash</span>
                            </p>
                          ) : isMatch ? (
                            <p className="text-[10px] text-quorum-green-light/80 font-mono flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-quorum-green" />
                              <span>Exact bit-for-bit consensus match</span>
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>

                  {/* Ed25519 Signature */}
                  <td className="py-3.5 px-4 min-w-[150px]">
                    <div className="flex items-center gap-1.5">
                      {isPending ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-quorum-amber font-semibold px-2 py-0.5 rounded bg-quorum-amber-bg/40 border border-quorum-amber-border/40">
                          PENDING
                        </span>
                      ) : att.signatureValid ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-quorum-green font-semibold px-2 py-0.5 rounded bg-quorum-green-bg/40 border border-quorum-green-border/40">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          VALID
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-quorum-red font-semibold px-2 py-0.5 rounded bg-quorum-red-bg/40 border border-quorum-red-border/40">
                          <XCircle className="w-3.5 h-3.5" />
                          INVALID
                        </span>
                      )}
                      {!isPending && (
                        <>
                          <span
                            className="font-mono text-[10px] text-brand-subtle hidden xl:inline"
                            title={att.signature}
                          >
                            ({truncateHash(att.signature, 4, 3)})
                          </span>
                          <CopyButton text={att.signature} title="Copy Ed25519 signature" />
                        </>
                      )}
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
                <strong>Conflict Detected:</strong> 1 builder produced a diverging artifact hash. Quorum consensus policy isolates the anomaly.
              </span>
            </div>
            <span className="font-mono text-[11px] font-semibold text-quorum-amber">
              Majority: 2 · Conflicting: 1
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
