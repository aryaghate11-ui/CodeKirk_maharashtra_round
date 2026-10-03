import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { DecisionBadge } from '../components/common/Badge';
import { CopyButton } from '../components/common/CopyButton';
import { BuilderEvidenceTable } from '../components/verification/BuilderEvidenceTable';
import { QuorumSummaryCard } from '../components/verification/QuorumSummaryCard';
import { WhyDecisionCard } from '../components/verification/WhyDecisionCard';
import { VerificationProgressModal } from '../components/verification/VerificationProgressModal';
import { VerificationResult, ScenarioId, Release } from '../types';
import { api } from '../services/api';
import { truncateHash } from '../lib/utils';
import {
  ShieldCheck,
  GitBranch,
  Play,
  RotateCcw,
  ExternalLink,
  Layers,
  Sparkles,
  FileCode2,
} from 'lucide-react';

interface ReleaseVerificationPageProps {
  selectedReleaseId?: string;
}

export const ReleaseVerificationPage: React.FC<ReleaseVerificationPageProps> = ({
  selectedReleaseId = 'rel-hey-01',
}) => {
  const [currentScenario, setCurrentScenario] = useState<ScenarioId>('conflict');
  const [activePolicyType, setActivePolicyType] = useState<'2-of-3' | '3-of-3'>('2-of-3');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyingModalOpen, setIsVerifyingModalOpen] = useState(false);
  const [allReleases, setAllReleases] = useState<Release[]>([]);
  const [selectedRelId, setSelectedRelId] = useState(selectedReleaseId);

  useEffect(() => {
    if (selectedReleaseId) {
      setSelectedRelId(selectedReleaseId);
    }
  }, [selectedReleaseId]);

  const loadVerification = async (
    scenario: ScenarioId,
    policy: '2-of-3' | '3-of-3',
    relId: string = selectedRelId
  ) => {
    setIsLoading(true);
    try {
      const data = await api.runDemoScenario(scenario, policy, relId);
      setVerification(data);
    } catch (err) {
      console.error('Failed to run verification', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    api.getReleases().then(setAllReleases);
  }, []);

  useEffect(() => {
    loadVerification(currentScenario, activePolicyType, selectedRelId);
  }, [currentScenario, activePolicyType, selectedRelId]);

  const handleRunVerification = () => {
    setIsVerifyingModalOpen(true);
  };

  const handleModalFinished = () => {
    setIsVerifyingModalOpen(false);
    loadVerification(currentScenario, activePolicyType, selectedRelId);
  };

  if (!verification) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-quorum-green border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-mono text-brand-muted">Loading verification telemetry...</p>
        </div>
      </div>
    );
  }

  const { release, attestations, consensusHash, conflictDetected, decision } = verification;

  return (
    <div className="space-y-6">
      {/* Primary Verification Header Card */}
      <Card className="border-brand-border-bright shadow-panel">
        <div className="p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-brand-muted">
                  RELEASE VERIFICATION
                </span>
                <DecisionBadge decision={decision} size="lg" />
              </div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                <span>{release.name}</span>
                <span className="text-sm font-mono font-normal text-brand-muted">
                  ({release.version})
                </span>
              </h2>
            </div>

            {/* Quick Interactive Scenario Controller for Judges */}
            <div className="flex flex-wrap items-center gap-2.5 bg-brand-bg-deep/80 p-2 rounded-xl border border-brand-border">
              {allReleases.length > 0 && (
                <div className="space-y-0.5">
                  <span className="text-[10px] font-mono text-brand-subtle block px-1">
                    PACKAGE:
                  </span>
                  <select
                    value={selectedRelId}
                    onChange={(e) => setSelectedRelId(e.target.value)}
                    className="bg-brand-panel-elevated text-xs font-medium text-white border border-brand-border-bright rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:ring-1 focus:ring-quorum-green max-w-[150px] truncate"
                  >
                    {allReleases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.version})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-0.5">
                <span className="text-[10px] font-mono text-brand-subtle block px-1">
                  DEMO SCENARIO:
                </span>
                <select
                  value={currentScenario}
                  onChange={(e) => setCurrentScenario(e.target.value as ScenarioId)}
                  className="bg-brand-panel-elevated text-xs font-medium text-white border border-brand-border-bright rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:ring-1 focus:ring-quorum-green"
                >
                  <option value="valid">Valid Release (3/3 Consensus)</option>
                  <option value="conflict">Builder Disagreement (1 Conflict)</option>
                  <option value="tampered">Tampered Binary (Vendor Asset Hijacked)</option>
                  <option value="invalidSignature">Invalid Signature (Rogue Node)</option>
                  <option value="auditTampering">Audit Tampering (Merkle Divergence)</option>
                </select>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-mono text-brand-subtle block px-1">
                  POLICY:
                </span>
                <select
                  value={activePolicyType}
                  onChange={(e) => setActivePolicyType(e.target.value as '2-of-3' | '3-of-3')}
                  className="bg-brand-panel-elevated text-xs font-medium text-white border border-brand-border-bright rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:ring-1 focus:ring-quorum-green"
                >
                  <option value="2-of-3">2-of-3 Quorum (Majority)</option>
                  <option value="3-of-3">3-of-3 Quorum (Strict Unanimous)</option>
                </select>
              </div>

              <button
                onClick={handleRunVerification}
                disabled={isLoading}
                className="self-end px-3.5 py-2 rounded-lg text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Verify</span>
              </button>
            </div>
          </div>

          {/* Technical Metadata Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-brand-border/60">
            {/* Repository */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Repository
              </span>
              <div className="flex items-center justify-between">
                <a
                  href={`https://${release.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-brand-text hover:text-quorum-green-light truncate flex items-center gap-1"
                >
                  {release.repo}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
                <CopyButton text={release.repo} title="Copy repository URL" />
              </div>
            </div>

            {/* Pinned Commit */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Pinned Source Commit
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-white" title={release.commit}>
                  {truncateHash(release.commit, 8, 6)}
                </span>
                <CopyButton text={release.commit} title="Copy commit SHA" />
              </div>
            </div>

            {/* Target Artifact */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Target Artifact
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-white truncate">
                  {release.artifactName}
                </span>
                <CopyButton text={release.artifactName} title="Copy artifact name" />
              </div>
            </div>

            {/* Published Binary Hash */}
            <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border space-y-1">
              <span className="text-[10px] font-mono text-brand-muted uppercase block">
                Published Artifact SHA-256
              </span>
              <div className="flex items-center justify-between">
                <span
                  className="font-mono text-xs text-brand-muted truncate"
                  title={release.publishedArtifactHash}
                >
                  {truncateHash(release.publishedArtifactHash, 6, 4)}
                </span>
                <CopyButton
                  text={release.publishedArtifactHash}
                  title="Copy published SHA-256"
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Evidence Grid: Builder Evidence Table (Full width or split) */}
      <Card>
        <CardHeader
          title="Independent Builder Evidence"
          subtitle="Cryptographic build statements submitted by disparate execution environments"
          icon={<Layers className="w-4 h-4 text-quorum-green" />}
          badge={
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-brand-panel-elevated border border-brand-border text-brand-text">
              {attestations.length} / {verification.totalBuilders} Attestations Received
            </span>
          }
        />
        <BuilderEvidenceTable
          attestations={attestations}
          consensusHash={consensusHash}
          conflictDetected={conflictDetected}
        />
      </Card>

      {/* Dual Bottom Section: Quorum Summary (Left) + Why This Decision (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <QuorumSummaryCard verification={verification} />
        <WhyDecisionCard verification={verification} />
      </div>

      {/* Verification Multi-Step Progress Modal */}
      <VerificationProgressModal
        isOpen={isVerifyingModalOpen}
        onComplete={handleModalFinished}
        targetPackage={`${release.name} (${release.version})`}
      />
    </div>
  );
};
