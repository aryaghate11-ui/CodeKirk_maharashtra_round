import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { VerificationDecision } from '../../types';
import { CheckCircle2, XCircle, Scale, ArrowRight, ShieldCheck, ShieldAlert } from 'lucide-react';

interface PolicyComparatorProps {
  scenarioId: string;
  agreement: number;
  totalBuilders: number;
  decision2of3: VerificationDecision;
  decision3of3: VerificationDecision;
  activePolicy: '2-of-3' | '3-of-3';
  onTogglePolicy: (policy: '2-of-3' | '3-of-3') => void;
}

export const PolicyComparator: React.FC<PolicyComparatorProps> = ({
  scenarioId,
  agreement,
  totalBuilders,
  decision2of3,
  decision3of3,
  activePolicy,
  onTogglePolicy,
}) => {
  return (
    <Card className="border-brand-border-bright/70">
      <CardHeader
        title="Quorum Policy Sensitivity Matrix"
        subtitle="Evaluating the exact same cryptographic evidence under distinct governance thresholds"
        icon={<Scale className="w-4 h-4 text-quorum-blue-light" />}
      />
      <CardBody className="space-y-4">
        <p className="text-xs text-brand-muted">
          Decentralized supply chains allow package owners to balance resilience against downtime versus zero-divergence intolerance. Compare how the current evidence is scored under both standard and strict policies:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Policy Option 1: 2-of-3 Majority Quorum */}
          <div
            onClick={() => onTogglePolicy('2-of-3')}
            className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 relative ${
              activePolicy === '2-of-3'
                ? 'bg-brand-panel-elevated border-quorum-green-border shadow-glow-green ring-1 ring-quorum-green/30'
                : 'bg-brand-bg-deep/70 border-brand-border hover:border-brand-border-bright'
            }`}
          >
            {activePolicy === '2-of-3' && (
              <span className="absolute top-3 right-3 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border">
                ACTIVE VIEW
              </span>
            )}

            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
                  Policy Model A
                </span>
                <h4 className="text-base font-bold text-white font-mono flex items-center gap-2">
                  2-of-3 Quorum
                  <span className="text-xs font-sans font-normal text-brand-muted">
                    (Fault-Tolerant Majority)
                  </span>
                </h4>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Required Agreement:</span>
                  <span className="font-mono text-white font-semibold">k = 2 of 3</span>
                </div>
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Recorded Agreement:</span>
                  <span className="font-mono text-white font-semibold">
                    {agreement} of {totalBuilders} Builders
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Single-Node Flake Tolerance:</span>
                  <span className="text-quorum-green-light font-medium">Permitted (1 divergence tolerated)</span>
                </div>
              </div>

              {/* Result Banner */}
              <div
                className={`p-3 rounded-lg flex items-center justify-between text-xs font-semibold ${
                  decision2of3 === 'ACCEPTED'
                    ? 'bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border'
                    : 'bg-quorum-red-bg text-quorum-red-light border border-quorum-red-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  {decision2of3 === 'ACCEPTED' ? (
                    <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-quorum-red flex-shrink-0" />
                  )}
                  <span>Result: {decision2of3}</span>
                </div>
                <span className="text-[11px] font-mono">
                  {agreement >= 2 ? 'Threshold Met' : 'Threshold Unmet'}
                </span>
              </div>
            </div>
          </div>

          {/* Policy Option 2: 3-of-3 Strict Unanimous Quorum */}
          <div
            onClick={() => onTogglePolicy('3-of-3')}
            className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 relative ${
              activePolicy === '3-of-3'
                ? 'bg-brand-panel-elevated border-quorum-green-border shadow-glow-green ring-1 ring-quorum-green/30'
                : 'bg-brand-bg-deep/70 border-brand-border hover:border-brand-border-bright'
            }`}
          >
            {activePolicy === '3-of-3' && (
              <span className="absolute top-3 right-3 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border">
                ACTIVE VIEW
              </span>
            )}

            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-mono text-brand-muted uppercase tracking-wider block">
                  Policy Model B
                </span>
                <h4 className="text-base font-bold text-white font-mono flex items-center gap-2">
                  3-of-3 Quorum
                  <span className="text-xs font-sans font-normal text-brand-muted">
                    (Strict Zero-Tolerance)
                  </span>
                </h4>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Required Agreement:</span>
                  <span className="font-mono text-white font-semibold">k = 3 of 3</span>
                </div>
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Recorded Agreement:</span>
                  <span className="font-mono text-white font-semibold">
                    {agreement} of {totalBuilders} Builders
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-brand-border/40">
                  <span className="text-brand-muted">Single-Node Flake Tolerance:</span>
                  <span className="text-quorum-red-light font-medium">None (Any divergence halts release)</span>
                </div>
              </div>

              {/* Result Banner */}
              <div
                className={`p-3 rounded-lg flex items-center justify-between text-xs font-semibold ${
                  decision3of3 === 'ACCEPTED'
                    ? 'bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border'
                    : 'bg-quorum-red-bg text-quorum-red-light border border-quorum-red-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  {decision3of3 === 'ACCEPTED' ? (
                    <CheckCircle2 className="w-4 h-4 text-quorum-green flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-quorum-red flex-shrink-0" />
                  )}
                  <span>Result: {decision3of3}</span>
                </div>
                <span className="text-[11px] font-mono">
                  {agreement >= 3 ? 'Unanimous' : 'Zero Tolerance Halt'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic educational takeaway */}
        <div className="p-3 rounded-lg bg-brand-panel-elevated/30 border border-brand-border text-xs text-brand-muted flex items-start gap-2">
          <ArrowRight className="w-4 h-4 text-quorum-green flex-shrink-0 mt-0.5" />
          <span>
            {scenarioId === 'conflict' ? (
              <strong className="text-white">
                Live Demonstration: In a 2-of-3 policy, the release is ACCEPTED despite 1 builder divergence. But switching to 3-of-3 flips the decision to REJECTED.
              </strong>
            ) : (
              <span>
                Configurable threshold policies empower release engineers to enforce stringent rules for critical kernel or cryptographic binaries while maintaining developer velocity.
              </span>
            )}
          </span>
        </div>
      </CardBody>
    </Card>
  );
};
