import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { ProgressRing, QuorumStatusBanner } from '../common/ProgressRing';
import { DecisionBadge } from '../common/Badge';
import { VerificationResult } from '../../types';
import { ShieldCheck, ShieldAlert, AlertTriangle, Scale, KeyRound, GitCompare } from 'lucide-react';

interface QuorumSummaryCardProps {
  verification: VerificationResult;
}

export const QuorumSummaryCard: React.FC<QuorumSummaryCardProps> = ({ verification }) => {
  const { agreement, totalBuilders, policy, policySatisfied, conflictDetected, decision } =
    verification;

  const validSigCount = verification.attestations.filter((a) => a.signatureValid).length;

  return (
    <Card
      glow={
        decision === 'ACCEPTED'
          ? 'green'
          : decision === 'REJECTED'
          ? 'red'
          : 'amber'
      }
      className="h-full flex flex-col justify-between"
    >
      <div>
        <CardHeader
          title="Original Quorum Decision"
          subtitle="Historical cryptographic consensus evaluation"
          icon={<Scale className="w-4 h-4 text-quorum-green" />}
          badge={<DecisionBadge decision={decision} size="sm" />}
        />

        <CardBody className="space-y-5">
          {/* Main Visual Agreement & Progress */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/70">
            <ProgressRing
              current={agreement}
              total={totalBuilders}
              threshold={policy.k}
              satisfied={policySatisfied}
              conflict={conflictDetected}
              size={76}
              strokeWidth={7}
            />

            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold font-mono text-white">
                  {agreement} / {totalBuilders}
                </span>
                <span className="text-xs text-brand-muted">Consensus Ratio</span>
              </div>
              <p className="text-xs text-brand-muted leading-tight">
                {agreement >= policy.k ? (
                  <span className="text-quorum-green-light font-medium">
                    ✓ Threshold satisfied ({policy.k}-of-{policy.n} policy)
                  </span>
                ) : (
                  <span className="text-quorum-red-light font-medium">
                    ✕ Threshold unmet: Needs {policy.k} matching builders
                  </span>
                )}
              </p>
              <div className="text-[11px] font-mono text-brand-subtle">
                Policy Rule: {policy.type.toUpperCase()} (k={policy.k}, n={policy.n})
              </div>
            </div>
          </div>

          {/* Metric Matrix */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Agreement Metric */}
            <div className="p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60 space-y-1">
              <span className="text-[11px] text-brand-muted flex items-center gap-1.5">
                <GitCompare className="w-3 h-3 text-brand-subtle" />
                Agreement
              </span>
              <div className="font-mono text-sm font-semibold text-white">
                {agreement} of {totalBuilders} Builders
              </div>
            </div>

            {/* Policy Metric */}
            <div className="p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60 space-y-1">
              <span className="text-[11px] text-brand-muted flex items-center gap-1.5">
                <Scale className="w-3 h-3 text-brand-subtle" />
                Configured Policy
              </span>
              <div className="font-mono text-sm font-semibold text-quorum-green-light">
                {policy.k}-of-{policy.n} Quorum
              </div>
            </div>

            {/* Signatures Metric */}
            <div className="p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60 space-y-1">
              <span className="text-[11px] text-brand-muted flex items-center gap-1.5">
                <KeyRound className="w-3 h-3 text-brand-subtle" />
                Signatures
              </span>
              <div
                className={`font-mono text-sm font-semibold ${
                  validSigCount === totalBuilders ? 'text-quorum-green-light' : 'text-quorum-red-light'
                }`}
              >
                {validSigCount} / {totalBuilders} Valid
              </div>
            </div>

            {/* Conflict Metric */}
            <div className="p-3 rounded-lg bg-brand-panel-elevated/50 backdrop-blur-sm border border-brand-border/60 space-y-1">
              <span className="text-[11px] text-brand-muted flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-brand-subtle" />
                Conflict Status
              </span>
              <div
                className={`font-mono text-sm font-semibold ${
                  conflictDetected ? 'text-quorum-amber' : 'text-quorum-green-light'
                }`}
              >
                {conflictDetected ? 'Detected (1)' : 'None (0)'}
              </div>
            </div>
          </div>

          {/* Banner */}
          <QuorumStatusBanner
            satisfied={policySatisfied}
            policy={policy}
            agreement={agreement}
            conflict={conflictDetected}
          />
        </CardBody>
      </div>

      {/* Final Decision Banner at bottom of card */}
      <div
        className={`p-4 border-t backdrop-blur-sm flex items-center justify-between ${
          decision === 'ACCEPTED'
            ? 'bg-quorum-green-bg/60 border-quorum-green-border text-quorum-green-light'
            : decision === 'REJECTED'
            ? 'bg-quorum-red-bg/60 border-quorum-red-border text-quorum-red-light'
            : 'bg-quorum-amber-bg/60 border-quorum-amber-border text-quorum-amber-light'
        }`}
      >
        <div className="flex items-center gap-2">
          {decision === 'ACCEPTED' ? (
            <ShieldCheck className="w-5 h-5 text-quorum-green" />
          ) : decision === 'REJECTED' ? (
            <ShieldAlert className="w-5 h-5 text-quorum-red" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-quorum-amber" />
          )}
          <div>
            <span className="text-xs uppercase font-mono tracking-wider opacity-80 block">
              Original Release Decision
            </span>
            <span className="text-base font-bold tracking-tight text-white">
              RELEASE {decision}
            </span>
          </div>
        </div>

        <span className="text-[11px] font-mono opacity-80">
          Anchored in Local Hash-Linked Audit Log
        </span>
      </div>
    </Card>
  );
};
