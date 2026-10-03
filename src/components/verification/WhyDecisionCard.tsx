import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { VerificationResult } from '../../types';
import { FileQuestion, CheckCircle2, XCircle, AlertCircle, Shield } from 'lucide-react';

interface WhyDecisionCardProps {
  verification: VerificationResult;
}

export const WhyDecisionCard: React.FC<WhyDecisionCardProps> = ({ verification }) => {
  const { decision, explanation, policy, agreement, totalBuilders, conflictDetected } =
    verification;

  const validSignatures = verification.attestations.every((a) => a.signatureValid);
  const consensusThresholdMet = agreement >= policy.k;
  const publishedArtifactMatches =
    verification.consensusHash === verification.release.publishedArtifactHash;

  return (
    <Card className="h-full">
      <CardHeader
        title="Why This Decision?"
        subtitle="Backend-evaluated consensus justification"
        icon={<FileQuestion className="w-4 h-4 text-brand-muted" />}
      />
      <CardBody className="space-y-4">
        {/* Core Narrative returned from Verifier */}
        <div className="p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/70 text-sm text-brand-text leading-relaxed">
          <p className="font-sans font-medium text-slate-200">
            "{explanation}"
          </p>
        </div>

        {/* Verification Checkpoint Criteria (Audited Rules) */}
        <div className="space-y-2.5 pt-1">
          <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider block">
            Consensus Rule Evaluation
          </span>

          <div className="space-y-2 text-xs">
            {/* Rule 1: Signature Authenticity */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60">
              <div className="flex items-center gap-2">
                {validSignatures ? (
                  <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-quorum-red flex-shrink-0" />
                )}
                <span className="text-brand-text">
                  Builder Cryptographic Signatures
                </span>
              </div>
              <span
                className={`font-mono text-[11px] ${
                  validSignatures ? 'text-quorum-green-light' : 'text-quorum-red-light'
                }`}
              >
                {validSignatures ? 'PASS (Ed25519 valid)' : 'FAIL (untrusted)'}
              </span>
            </div>

            {/* Rule 2: Minimum Agreement Threshold */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60">
              <div className="flex items-center gap-2">
                {consensusThresholdMet ? (
                  <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-quorum-red flex-shrink-0" />
                )}
                <span className="text-brand-text">
                  Reproducible Quorum Threshold ({policy.k} of {policy.n})
                </span>
              </div>
              <span
                className={`font-mono text-[11px] ${
                  consensusThresholdMet ? 'text-quorum-green-light' : 'text-quorum-red-light'
                }`}
              >
                {consensusThresholdMet ? `PASS (${agreement}/${totalBuilders})` : `FAIL (${agreement}/${policy.k})`}
              </span>
            </div>

            {/* Rule 3: Published Binary Parity */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60">
              <div className="flex items-center gap-2">
                {publishedArtifactMatches ? (
                  <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-quorum-red flex-shrink-0" />
                )}
                <span className="text-brand-text">
                  Published Binary matches Consensus Hash
                </span>
              </div>
              <span
                className={`font-mono text-[11px] ${
                  publishedArtifactMatches ? 'text-quorum-green-light' : 'text-quorum-red-light'
                }`}
              >
                {publishedArtifactMatches ? 'MATCH' : 'TAMPERED / MISMATCH'}
              </span>
            </div>

            {/* Rule 4: Isolated Conflict Tolerance */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60">
              <div className="flex items-center gap-2">
                {!conflictDetected ? (
                  <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-quorum-amber flex-shrink-0" />
                )}
                <span className="text-brand-text">
                  Zero Divergence Tolerance
                </span>
              </div>
              <span
                className={`font-mono text-[11px] ${
                  !conflictDetected ? 'text-quorum-green-light' : 'text-quorum-amber'
                }`}
              >
                {!conflictDetected ? 'STRICT CONSENSUS' : 'CONFLICT ISOLATED'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-brand-bg-deep/50 backdrop-blur-sm border border-brand-border/60 text-[11px] text-brand-muted flex items-start gap-2">
          <Shield className="w-4 h-4 text-brand-subtle flex-shrink-0 mt-0.5" />
          <span>
            Evaluated by Quorum's cryptographic consensus engine and SQLite audit log.
          </span>
        </div>
      </CardBody>
    </Card>
  );
};
