import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { DecisionBadge } from '../components/common/Badge';
import { CopyButton } from '../components/common/CopyButton';
import { BuilderEvidenceTable } from '../components/verification/BuilderEvidenceTable';
import { QuorumSummaryCard } from '../components/verification/QuorumSummaryCard';
import { WhyDecisionCard } from '../components/verification/WhyDecisionCard';
import { VerificationProgressModal } from '../components/verification/VerificationProgressModal';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import { VerificationResult, Release } from '../types';
import { api } from '../services/api';
import { truncateHash } from '../lib/utils';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Play,
  ExternalLink,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
  FileCode,
} from 'lucide-react';

interface ReleaseVerificationPageProps {
  selectedReleaseId?: string;
}

export const ReleaseVerificationPage: React.FC<ReleaseVerificationPageProps> = ({
  selectedReleaseId = '',
}) => {
  const [activePolicyType, setActivePolicyType] = useState<'2-of-3' | '3-of-3'>('2-of-3');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<Error | string | null>(null);
  const [isVerifyingModalOpen, setIsVerifyingModalOpen] = useState(false);
  const [allReleases, setAllReleases] = useState<Release[]>([]);
  const [selectedRelId, setSelectedRelId] = useState(selectedReleaseId);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  useEffect(() => {
    if (selectedReleaseId) {
      setSelectedRelId(selectedReleaseId);
    }
  }, [selectedReleaseId]);

  const loadVerification = async (relId: string = selectedRelId) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const data = await api.getVerification(relId);
      setVerification(data);
    } catch (err: any) {
      console.error('Failed to run verification', err);
      setApiError(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    api.getReleases()
      .then((releases) => {
        setAllReleases(releases);
        if (releases.length > 0 && !selectedRelId) {
          setSelectedRelId(releases[0].id);
        }
      })
      .catch((err) => console.warn('Could not fetch releases list', err));
  }, []);

  useEffect(() => {
    if (selectedRelId) loadVerification(selectedRelId);
  }, [selectedRelId]);

  const handleRunVerification = () => {
    setIsVerifyingModalOpen(true);
  };

  const handleModalFinished = () => {
    setIsVerifyingModalOpen(false);
    setIsLoading(true);
    setApiError(null);
    api.evaluateRelease(selectedRelId, activePolicyType)
      .then(setVerification)
      .catch(setApiError)
      .finally(() => setIsLoading(false));
  };

  if (!verification) {
    return (
      <div className="space-y-6">
        {apiError && (
          <ApiErrorBanner
            error={apiError}
            endpoint="/releases/{id}"
            onRetry={() => loadVerification(selectedRelId)}
          />
        )}
        <div className="flex items-center justify-center min-h-[350px]">
          <div className="text-center space-y-3">
            {isLoading ? (
              <>
                <div className="w-8 h-8 rounded-full border-2 border-quorum-green border-t-transparent animate-spin mx-auto" />
                <p className="text-xs font-mono text-brand-muted">Connecting to verifier...</p>
              </>
            ) : (
              <p className="text-xs font-mono text-quorum-red-light">Verification engine unreachable.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { release, attestations, consensusHash, conflictDetected, decision } = verification;

  return (
    <div className="space-y-6">
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          endpoint="/releases/{id}"
          onRetry={() => loadVerification(selectedRelId)}
        />
      )}

      {/* Top Header Card: Title & Controls */}
      <Card className="border-brand-border-bright shadow-panel">
        <div className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Title & Package Info */}
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-brand-bg-deep border border-brand-border text-[11px] font-mono font-semibold text-brand-muted">
                <Sparkles className="w-3.5 h-3.5 text-quorum-green" />
                Quorum Verification
              </div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
                <span>{release.name}</span>
                <span className="text-sm font-mono font-normal text-brand-muted px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border">
                  {release.version}
                </span>
              </h2>
              <p className="text-xs text-brand-muted">
                Evaluating independent builder attestations against the candidate release binary.
              </p>
            </div>

            {/* Quick Interactive Controls */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-brand-bg-deep/75 backdrop-blur-md p-3 rounded-xl border border-brand-border-bright/60 shadow-sm">
              {allReleases.length > 0 && (
                <div className="flex-1 sm:flex-initial space-y-1">
                  <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block px-1 tracking-wider">
                    Select Package
                  </label>
                  <select
                    value={selectedRelId}
                    onChange={(e) => setSelectedRelId(e.target.value)}
                    disabled={isLoading}
                    className="w-full sm:w-auto min-w-[170px] bg-brand-panel-elevated/85 backdrop-blur-sm text-xs font-semibold text-white border border-brand-border-bright rounded-lg px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-quorum-green/50 disabled:opacity-50 transition-all"
                  >
                    {allReleases.map((r) => (
                      <option key={r.id} value={r.id} className="bg-brand-bg text-white py-1">
                        {r.name} ({r.version})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex-1 sm:flex-initial space-y-1">
                <label className="text-[10px] font-mono font-semibold text-brand-muted uppercase block px-1 tracking-wider">
                  Quorum Policy
                </label>
                <select
                  value={activePolicyType}
                  onChange={(e) => setActivePolicyType(e.target.value as '2-of-3' | '3-of-3')}
                  disabled={isLoading}
                  className="w-full sm:w-auto min-w-[160px] bg-brand-panel-elevated/85 backdrop-blur-sm text-xs font-semibold text-white border border-brand-border-bright rounded-lg px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-quorum-green/50 disabled:opacity-50 transition-all"
                >
                  <option value="2-of-3" className="bg-brand-bg text-white py-1">2-of-3 (Majority)</option>
                  <option value="3-of-3" className="bg-brand-bg text-white py-1">3-of-3 (Unanimous)</option>
                </select>
              </div>

              <div className="self-end pt-1">
                <button
                  onClick={handleRunVerification}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-glow-green cursor-pointer"
                  title="Execute decentralized build verification"
                >
                  {isLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-black" />
                      <span>Run Verification</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Prominent Verification Decision Banner */}
      <div
        className={`p-5 rounded-2xl border backdrop-blur-md transition-all ${
          decision === 'ACCEPTED'
            ? 'bg-quorum-green-bg/40 border-quorum-green-border text-white'
            : decision === 'REJECTED'
            ? 'bg-quorum-red-bg/40 border-quorum-red-border text-white'
            : decision === 'CONFLICT'
            ? 'bg-quorum-amber-bg/40 border-quorum-amber-border text-white'
            : 'bg-brand-panel-elevated/80 border-brand-border text-white'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`p-3 rounded-xl border ${
                decision === 'ACCEPTED'
                  ? 'bg-quorum-green-bg border-quorum-green-border text-quorum-green'
                  : decision === 'REJECTED'
                  ? 'bg-quorum-red-bg border-quorum-red-border text-quorum-red'
                  : decision === 'CONFLICT'
                  ? 'bg-quorum-amber-bg border-quorum-amber-border text-quorum-amber'
                  : 'bg-brand-panel border-brand-border text-brand-muted'
              }`}
            >
              {decision === 'ACCEPTED' && <ShieldCheck className="w-6 h-6 text-quorum-green" />}
              {decision === 'REJECTED' && <ShieldAlert className="w-6 h-6 text-quorum-red" />}
              {decision === 'CONFLICT' && <AlertTriangle className="w-6 h-6 text-quorum-amber" />}
              {decision === 'PENDING' && <Layers className="w-6 h-6 text-brand-muted" />}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-brand-muted">
                  Decision Outcome:
                </span>
                <DecisionBadge decision={decision} size="lg" />
              </div>
              <p className="text-sm font-medium mt-1 text-slate-200">
                {decision === 'ACCEPTED' &&
                  `Verified: ${verification.agreement} of ${verification.totalBuilders} independent builders produced identical SHA-256 hashes matching the candidate binary.`}
                {decision === 'REJECTED' &&
                  'Rejected: The published candidate binary does not match the reproducible consensus hash produced by independent builders.'}
                {decision === 'CONFLICT' &&
                  'Builders Disagree: Independent builders produced conflicting artifact hashes from the same pinned source commit.'}
                {decision === 'PENDING' &&
                  'Pending: Awaiting required builder attestations.'}
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 sm:text-right font-mono text-xs">
            <span className="text-brand-muted block text-[11px] uppercase">Agreement Ratio</span>
            <span className="text-lg font-bold text-white">
              {verification.agreement} / {verification.totalBuilders} Builders
            </span>
          </div>
        </div>
      </div>

      {/* Security Educational Note */}
      <div className="p-4 rounded-xl bg-brand-panel/75 backdrop-blur-md border border-brand-border/70 text-xs text-brand-muted flex items-start gap-3">
        <Info className="w-4 h-4 text-quorum-blue-light flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-white">Why signatures alone aren't enough: </strong>
          A valid Ed25519 signature only proves <em>which builder</em> generated the attestation—it does not prove the binary was uncompromised. If a single build machine is compromised or non-deterministic, its signature will still be cryptographically valid. Quorum protects against this by verifying that multiple independent builders arrived at the <strong>exact same SHA-256 hash</strong>.
        </p>
      </div>

      {/* Builder Evidence Table */}
      <Card>
        <CardHeader
          title="Independent Builder Evidence"
          subtitle="Signed build statements submitted by independent execution environments"
          icon={<Layers className="w-4 h-4 text-quorum-green" />}
          badge={
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-brand-panel-elevated/75 backdrop-blur-sm border border-brand-border text-brand-text">
              {attestations.length} / {verification.totalBuilders} Attestations
            </span>
          }
        />
        <BuilderEvidenceTable
          attestations={attestations}
          consensusHash={consensusHash}
          conflictDetected={conflictDetected}
        />
      </Card>

      {/* Dual Bottom Section: Quorum Decision Engine (Left) + Why This Decision (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <QuorumSummaryCard verification={verification} />
        <WhyDecisionCard verification={verification} />
      </div>

      {/* Expandable Technical Details Accordion */}
      <div className="rounded-xl border border-brand-border/70 bg-brand-panel/75 backdrop-blur-md overflow-hidden">
        <button
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-brand-panel-elevated/50 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <FileCode className="w-4 h-4 text-quorum-green" />
            <span>Technical Details (Repository, Pinned Commit, Artifact Hashes)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono text-brand-muted">
            <span>{showTechnicalDetails ? 'Collapse' : 'Expand'}</span>
            {showTechnicalDetails ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {showTechnicalDetails && (
          <div className="p-4 pt-0 border-t border-brand-border/60">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
              {/* Repository */}
              <div className="p-3 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/60 space-y-1">
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
                  Target Artifact Name
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
                  Published Candidate SHA-256
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

            {verification.auditChainHash && (
              <div className="mt-3 p-3 rounded-lg bg-brand-bg-deep/40 border border-brand-border flex items-center justify-between text-xs font-mono">
                <span className="text-brand-muted text-[11px]">Audit Chain Head:</span>
                <div className="flex items-center gap-1.5 text-quorum-green-light">
                  <span>{truncateHash(verification.auditChainHash, 16, 12)}</span>
                  <CopyButton text={verification.auditChainHash} title="Copy audit chain head" />
                </div>
              </div>
            )}
          </div>
        )}
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
