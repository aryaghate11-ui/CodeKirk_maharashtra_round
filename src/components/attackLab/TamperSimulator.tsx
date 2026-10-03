import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { ScenarioDefinition } from '../../types';
import { truncateHash } from '../../lib/utils';
import { CopyButton } from '../common/CopyButton';
import {
  ArrowDown,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  FileWarning,
  Flame,
} from 'lucide-react';
import { HASH_CANONICAL, HASH_DIVERGENT, HASH_MALICIOUS } from '../../mock/scenarios';

interface TamperSimulatorProps {
  scenario: ScenarioDefinition;
}

export const TamperSimulator: React.FC<TamperSimulatorProps> = ({ scenario }) => {
  return (
    <Card className="h-full border-brand-border-bright/80">
      <CardHeader
        title="Attack Vector & Cryptographic Flow"
        subtitle={scenario.name}
        icon={<Flame className="w-4 h-4 text-quorum-amber" />}
        badge={
          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-brand-bg-deep/70 backdrop-blur-sm border border-brand-border text-quorum-amber">
            SIMULATION
          </span>
        }
      />
      <CardBody className="space-y-6">
        {/* Threat Model Explanation */}
        <div className="p-3.5 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border text-xs space-y-1">
          <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
            Threat Analysis & Defense Mechanism
          </span>
          <p className="text-slate-200 leading-relaxed font-sans">
            {scenario.threatModel}
          </p>
        </div>

        {/* Visual Transformation depending on scenario */}
        {scenario.id === 'conflict' && (
          <div className="space-y-3">
            <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
              Builder Divergence Mutation
            </span>

            <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-4">
              {/* Builder 03 Original State */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border">
                <div className="space-y-0.5">
                  <div className="font-mono text-xs font-semibold text-white">
                    Builder 03 (Local Witness) — Source Compilation
                  </div>
                  <div className="font-mono text-[11px] text-quorum-green-light">
                    {truncateHash(HASH_CANONICAL, 12, 8)}
                  </div>
                </div>
                <span className="text-[11px] font-mono text-quorum-green">EXPECTED</span>
              </div>

              {/* Mutation Arrow */}
              <div className="flex items-center justify-center gap-2 text-quorum-amber text-xs font-mono font-semibold py-1">
                <ArrowDown className="w-4 h-4 animate-bounce" />
                <span>ENVIRONMENTAL DIVERGENCE / TIME SKEW</span>
                <ArrowDown className="w-4 h-4 animate-bounce" />
              </div>

              {/* Builder 03 Divergent Output */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-quorum-amber-bg/30 backdrop-blur-sm border border-quorum-amber-border/70">
                <div className="space-y-0.5">
                  <div className="font-mono text-xs font-semibold text-white">
                    Builder 03 Produced Artifact Hash
                  </div>
                  <div className="font-mono text-[11px] text-quorum-amber font-bold">
                    {truncateHash(HASH_DIVERGENT, 12, 8)}
                  </div>
                </div>
                <span className="text-[11px] font-mono text-quorum-amber font-bold">
                  CONFLICT (HASH B)
                </span>
              </div>
            </div>
          </div>
        )}

        {scenario.id === 'tampered' && (
          <div className="space-y-3">
            <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
              Upstream Asset Substitution
            </span>

            <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-4">
              <div className="p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border space-y-1">
                <span className="text-[10px] font-mono text-quorum-green-light uppercase">
                  Consensus of 3 Independent Builders (Source Code Parity)
                </span>
                <div className="font-mono text-xs text-white">
                  SHA-256: {truncateHash(HASH_CANONICAL, 16, 12)}
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-quorum-red text-xs font-mono font-semibold">
                <ArrowDown className="w-4 h-4" />
                <span>GITHUB RELEASES ARTIFACT TAMPERED IN TRANSIT</span>
                <ArrowDown className="w-4 h-4" />
              </div>

              <div className="p-3 rounded-lg bg-quorum-red-bg/40 backdrop-blur-sm border border-quorum-red-border space-y-1">
                <span className="text-[10px] font-mono text-quorum-red-light uppercase">
                  Published Binary Hash Downloaded by End User
                </span>
                <div className="font-mono text-xs text-quorum-red font-bold">
                  SHA-256: {truncateHash(HASH_MALICIOUS, 16, 12)}
                </div>
              </div>
            </div>
          </div>
        )}

        {scenario.id === 'invalidSignature' && (
          <div className="space-y-3">
            <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
              Cryptographic Attestation Verification
            </span>

            <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border text-xs">
                <span className="font-mono text-white">Builder 01 (Northstar)</span>
                <span className="font-mono text-quorum-green">Ed25519: VALID</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border text-xs">
                <span className="font-mono text-white">Builder 02 (Parallax)</span>
                <span className="font-mono text-quorum-green">Ed25519: VALID</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-quorum-red-bg/30 backdrop-blur-sm border border-quorum-red-border text-xs">
                <span className="font-mono text-white">Builder 03 (Untrusted Node)</span>
                <span className="font-mono text-quorum-red font-bold">Ed25519: SIGNATURE INVALID</span>
              </div>

              <div className="p-2 text-[11px] font-mono text-quorum-red-light bg-quorum-red-bg/20 backdrop-blur-sm rounded border border-quorum-red-border/50 text-center">
                Attestation 03 discarded prior to quorum aggregation.
              </div>
            </div>
          </div>
        )}

        {scenario.id === 'auditTampering' && (
          <div className="space-y-3">
            <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
              Merkle State Root Comparison
            </span>

            <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-4">
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border">
                  <span className="text-[10px] text-brand-muted uppercase block">
                    Original On-Chain Contract Merkle Root:
                  </span>
                  <div className="font-mono text-quorum-green-light mt-0.5">
                    0x8fd7c2091823746a81920391824701293847102938471029384710293847e341
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-purple-950/30 backdrop-blur-sm border border-purple-800/60">
                  <span className="text-[10px] text-purple-300 uppercase block">
                    Recomputed Evidence Hash from Database Record:
                  </span>
                  <div className="font-mono text-purple-300 font-bold mt-0.5">
                    0x5a21e481920391824701293847102938471029384710293847102938471902bb
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-purple-950/50 backdrop-blur-sm border border-purple-700 text-center text-xs font-mono font-bold text-purple-200">
                AUDIT INTEGRITY FAILED: Cryptographic Root Mismatch
              </div>
            </div>
          </div>
        )}

        {scenario.id === 'valid' && (
          <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-quorum-green-light">
              <ShieldCheck className="w-4 h-4 text-quorum-green" />
              <span>Full Deterministic Multi-Builder Consensus</span>
            </div>
            <div className="space-y-2 text-xs font-mono text-brand-muted">
              <div className="flex justify-between py-1 border-b border-brand-border/40">
                <span>Builder 01 (Ubuntu 24.04 Docker):</span>
                <span className="text-white">91ac82... ✓</span>
              </div>
              <div className="flex justify-between py-1 border-b border-brand-border/40">
                <span>Builder 02 (Debian 13 Podman):</span>
                <span className="text-white">91ac82... ✓</span>
              </div>
              <div className="flex justify-between py-1 border-b border-brand-border/40">
                <span>Builder 03 (Fedora 43 MicroVM):</span>
                <span className="text-white">91ac82... ✓</span>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
