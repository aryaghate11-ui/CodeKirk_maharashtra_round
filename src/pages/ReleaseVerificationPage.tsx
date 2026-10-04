import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileCheck2,
  FileCode,
  GitCompare,
  Hash,
  Info,
  Layers,
  Link2,
  Play,
  Radio,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Card, CardBody } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { CopyButton } from '../components/common/CopyButton';
import { BuilderEvidenceTable } from '../components/verification/BuilderEvidenceTable';
import { QuorumSummaryCard } from '../components/verification/QuorumSummaryCard';
import { WhyDecisionCard } from '../components/verification/WhyDecisionCard';
import { ArtifactHashVerifier } from '../components/verification/ArtifactHashVerifier';
import { VerificationProgressModal } from '../components/verification/VerificationProgressModal';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import { VerificationResult, Release, ReleaseTrustSummary } from '../types';
import { api } from '../services/api';
import { truncateHash } from '../lib/utils';
import { PageId } from '../components/layout/Sidebar';

interface ReleaseVerificationPageProps {
  selectedReleaseId?: string;
  onNavigate?: (page: PageId) => void;
}

const signalTone = (value: string): 'green' | 'amber' | 'red' | 'slate' => {
  if (/degraded|invalid|critical|high risk|mismatch|changed|rejected|failure/i.test(value)) return 'red';
  if (/verified|info risk|low risk|clear|match|confirmed|active/i.test(value)) return 'green';
  if (/pending|not assessed|not anchored|no monitor|checking|unconfirmed|recorded/i.test(value)) return 'amber';
  return 'slate';
};

export const ReleaseVerificationPage: React.FC<ReleaseVerificationPageProps> = ({
  selectedReleaseId = '',
  onNavigate,
}) => {
  const [activePolicyType, setActivePolicyType] = useState<'2-of-3' | '3-of-3'>('2-of-3');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<Error | string | null>(null);
  const [isVerifyingModalOpen, setIsVerifyingModalOpen] = useState(false);
  const [allReleases, setAllReleases] = useState<Release[]>([]);
  const [selectedRelId, setSelectedRelId] = useState(selectedReleaseId);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [trustSummary, setTrustSummary] = useState<ReleaseTrustSummary | null>(null);

  useEffect(() => {
    if (selectedReleaseId) setSelectedRelId(selectedReleaseId);
  }, [selectedReleaseId]);

  const loadVerification = async (releaseId: string = selectedRelId) => {
    if (!releaseId) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const [data, summary] = await Promise.all([
        api.getVerification(releaseId),
        api.getTrustSummary(releaseId),
      ]);
      setVerification(data);
      setTrustSummary(summary);
    } catch (err: any) {
      setApiError(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    api.getReleases()
      .then((releases) => {
        setAllReleases(releases);
        if (releases.length > 0 && !selectedRelId) setSelectedRelId(releases[0].id);
      })
      .catch((err) => setApiError(err));
  }, []);

  useEffect(() => { if (selectedRelId) void loadVerification(selectedRelId); }, [selectedRelId]);

  const handleModalFinished = () => {
    setIsVerifyingModalOpen(false);
    setIsLoading(true);
    setApiError(null);
    api.evaluateRelease(selectedRelId, activePolicyType)
      .then((result) => {
        setVerification(result);
        return loadVerification(selectedRelId);
      })
      .catch(setApiError)
      .finally(() => setIsLoading(false));
  };

  if (!verification) {
    return (
      <div className="space-y-5">
        {apiError && <ApiErrorBanner error={apiError} endpoint="/releases/{id} or /trust-summary" onRetry={() => loadVerification(selectedRelId)} />}
        <div className="min-h-[360px] grid place-items-center text-center">
          {isLoading ? <div><div className="w-8 h-8 rounded-full border-2 border-quorum-green border-t-transparent animate-spin mx-auto" /><p className="mt-3 text-sm text-brand-muted">Loading real verification evidence…</p></div> : <p className="text-sm text-quorum-red-light">Verification engine unavailable.</p>}
        </div>
      </div>
    );
  }

  const { release, attestations, consensusHash, conflictDetected, decision } = verification;
  const status = trustSummary?.currentStatus || (decision === 'ACCEPTED' ? 'VERIFIED' : decision);
  const recommendation = trustSummary?.overallRecommendation || 'REVIEW_REQUIRED';
  const installAllowed = trustSummary?.installationAllowed ?? false;
  const statusTone: 'green' | 'amber' | 'red' = installAllowed ? 'green' : recommendation === 'REVIEW_REQUIRED' ? 'amber' : 'red';
  const candidateMatches = consensusHash === release.publishedArtifactHash;
  const checks = [
    { label: 'Signatures valid', pass: verification.signaturesValid },
    { label: `${verification.agreement} of ${verification.totalBuilders} builders agree`, pass: verification.policySatisfied },
    { label: 'Candidate matches consensus', pass: candidateMatches },
    { label: conflictDetected ? 'Builder conflict detected' : 'No builder conflicts', pass: !conflictDetected },
  ];
  const trustCards = [
    { label: 'Artifact reproducibility', value: trustSummary?.artifactReproducibility.label || 'Checking…', icon: ShieldCheck, page: 'verification' as PageId },
    { label: 'Source risk', value: trustSummary?.sourceSentinel.label || 'Checking…', icon: GitCompare, page: 'sentinel' as PageId },
    { label: 'Distribution integrity', value: trustSummary?.relay.label || 'Checking…', icon: Radio, page: 'relay' as PageId },
    { label: 'Current builder trust', value: trustSummary?.livingVerification.label || 'Checking…', icon: RefreshCcw, page: 'living' as PageId },
    { label: 'Blockchain', value: trustSummary?.blockchain.label || 'Checking…', icon: Link2, page: 'audit' as PageId },
  ];

  return (
    <div className="space-y-5">
      {apiError && <ApiErrorBanner error={apiError} endpoint="/releases/{id} or /trust-summary" onRetry={() => loadVerification(selectedRelId)} />}

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 rounded-xl border border-brand-border/70 bg-brand-panel/65 backdrop-blur-md p-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-subtle">Selected release</p>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{release.name}</h2>
            <span className="text-xs font-mono text-brand-muted flex-shrink-0">{release.version}</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5">
          {allReleases.length > 0 && (
            <label className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
              Release
              <select value={selectedRelId} onChange={(event) => setSelectedRelId(event.target.value)} disabled={isLoading} className="mt-1 block w-full sm:w-56 bg-brand-bg-deep text-xs normal-case font-semibold text-white border border-brand-border-bright rounded-lg px-3 py-2 outline-none">
                {allReleases.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}
              </select>
            </label>
          )}
          <label className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
            Policy
            <select value={activePolicyType} onChange={(event) => setActivePolicyType(event.target.value as '2-of-3' | '3-of-3')} disabled={isLoading} className="mt-1 block w-full sm:w-44 bg-brand-bg-deep text-xs normal-case font-semibold text-white border border-brand-border-bright rounded-lg px-3 py-2 outline-none">
              <option value="2-of-3">2 of 3 · Majority</option>
              <option value="3-of-3">3 of 3 · Unanimous</option>
            </select>
          </label>
        </div>
      </div>

      <Card glow={statusTone} className="border-brand-border-bright">
        <CardBody className="p-5 sm:p-7">
          <div className="grid lg:grid-cols-[1fr_300px] gap-7">
            <div>
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl border ${installAllowed ? 'bg-quorum-green-bg border-quorum-green-border' : status === 'PENDING' ? 'bg-quorum-amber-bg border-quorum-amber-border' : 'bg-quorum-red-bg border-quorum-red-border'}`}>
                  {installAllowed ? <ShieldCheck className="w-7 h-7 text-quorum-green" /> : status === 'PENDING' ? <Layers className="w-7 h-7 text-quorum-amber" /> : <ShieldAlert className="w-7 h-7 text-quorum-red" />}
                </div>
                <div><p className="text-xs text-brand-muted">Overall installation recommendation</p><div className="mt-1"><Badge variant={statusTone} size="lg" dot>{recommendation.replace(/_/g, ' ')}</Badge></div></div>
              </div>

              <h3 className="mt-5 text-xl sm:text-2xl font-bold text-white">
                {installAllowed ? 'This release is recommended for installation.' : recommendation === 'REVIEW_REQUIRED' ? 'The artifact matches, but security review is incomplete.' : 'Do not install this release.'}
              </h3>
              <p className="mt-2 text-sm text-brand-muted leading-relaxed max-w-2xl">
                {trustSummary?.recommendationReason || verification.explanation}
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => setIsVerifyingModalOpen(true)} disabled={isLoading} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-quorum-green text-black text-sm font-bold hover:bg-quorum-green-light disabled:opacity-50 shadow-glow-green">
                  <Play className="w-4 h-4 fill-black" /> {isLoading ? 'Verifying…' : 'Run verification'}
                </button>
                <button onClick={() => document.getElementById('artifact-check')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-brand-border-bright bg-brand-panel-elevated/60 text-sm font-semibold text-white hover:border-quorum-green-border">
                  <FileCheck2 className="w-4 h-4" /> Check downloaded file
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-brand-bg-deep/65 border border-brand-border/70 p-5">
              <p className="text-[11px] uppercase tracking-wider text-brand-subtle">Why this decision</p>
              <div className="mt-3 space-y-2.5">
                {checks.map((check) => <div key={check.label} className="flex items-center gap-2 text-xs"><span className={`w-5 h-5 rounded-full grid place-items-center ${check.pass ? 'bg-quorum-green-bg text-quorum-green' : 'bg-quorum-red-bg text-quorum-red'}`}>{check.pass ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}</span><span className={check.pass ? 'text-brand-text' : 'text-quorum-red-light'}>{check.label}</span></div>)}
              </div>
              <div className={`mt-4 pt-4 border-t border-brand-border/70 flex items-center gap-2 text-sm font-semibold ${installAllowed ? 'text-quorum-green-light' : 'text-quorum-red-light'}`}>
                {installAllowed ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {installAllowed ? 'Installation recommended' : recommendation === 'REVIEW_REQUIRED' ? 'Manual review required' : 'Installation blocked'}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <section>
        <div className="flex items-end justify-between mb-3 px-1"><div><h3 className="text-sm font-bold text-white">Builder consensus</h3><p className="text-xs text-brand-muted mt-0.5">The evidence that determines the result.</p></div><span className="text-xs font-mono text-brand-muted">{verification.agreement}/{verification.totalBuilders} match</span></div>
        <div className="grid md:grid-cols-3 gap-3">
          {attestations.map((attestation, index) => {
            const matches = attestation.signatureValid && attestation.artifactHash === consensusHash;
            return (
              <div key={attestation.id || index} className={`min-w-0 overflow-hidden rounded-xl border p-4 bg-brand-panel/70 backdrop-blur-md ${matches ? 'border-quorum-green-border/70' : 'border-quorum-red-border/70'}`}>
                <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{attestation.builderName}</p><p className="mt-0.5 block max-w-full truncate text-[11px] text-brand-muted" title={attestation.environment}>{attestation.environment}</p></div><Badge variant={matches ? 'green' : 'red'} size="sm" dot>{matches ? 'MATCH' : attestation.signatureValid ? 'CONFLICT' : 'INVALID'}</Badge></div>
                <div className="mt-4 flex items-center gap-2 text-[11px] font-mono text-brand-subtle"><Hash className="w-3.5 h-3.5" /><span>{truncateHash(attestation.artifactHash, 10, 7)}</span></div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 px-1"><h3 className="text-sm font-bold text-white">Security & trust</h3><p className="text-xs text-brand-muted mt-0.5">Supporting checks remain available without competing with the main decision.</p></div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {trustCards.map((item) => {
            const Icon = item.icon;
            return <button key={item.label} onClick={() => onNavigate?.(item.page)} className="text-left rounded-xl border border-brand-border/70 bg-brand-panel/65 p-4 hover:border-brand-border-bright transition-colors"><div className="flex items-center justify-between"><Icon className="w-4 h-4 text-brand-muted" /><ArrowRight className="w-3.5 h-3.5 text-brand-subtle" /></div><p className="mt-3 text-xs text-brand-muted">{item.label}</p><div className="mt-1"><Badge variant={signalTone(item.value)} size="sm" dot>{item.value}</Badge></div></button>;
          })}
        </div>
      </section>

      <div id="artifact-check"><ArtifactHashVerifier releaseId={release.id} consensusHash={consensusHash} /></div>

      <div className="rounded-xl border border-brand-border/70 bg-brand-panel/70 backdrop-blur-md overflow-hidden">
        <button onClick={() => setShowTechnicalDetails((show) => !show)} className="w-full p-4 flex items-center justify-between text-left hover:bg-brand-panel-elevated/40 transition-colors" aria-expanded={showTechnicalDetails}>
          <div className="flex items-center gap-3"><FileCode className="w-4 h-4 text-quorum-green" /><div><p className="text-sm font-semibold text-white">Technical evidence</p><p className="text-xs text-brand-muted mt-0.5">Hashes, signatures, policy evaluation and audit chain</p></div></div>
          <div className="flex items-center gap-2 text-xs text-brand-muted"><span>{showTechnicalDetails ? 'Hide' : 'View details'}</span>{showTechnicalDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
        </button>

        {showTechnicalDetails && (
          <div className="border-t border-brand-border/60 p-4 sm:p-5 space-y-5">
            <BuilderEvidenceTable attestations={attestations} consensusHash={consensusHash} conflictDetected={conflictDetected} />
            <div className="grid lg:grid-cols-2 gap-5"><QuorumSummaryCard verification={verification} /><WhyDecisionCard verification={verification} /></div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border"><span className="text-[10px] uppercase text-brand-muted">Repository</span><div className="mt-1 flex items-center justify-between gap-2"><a href={`https://${release.repo}`} target="_blank" rel="noreferrer" className="text-xs text-white hover:text-quorum-green-light truncate">{release.repo} <ExternalLink className="inline w-3 h-3" /></a><CopyButton text={release.repo} /></div></div>
              <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border"><span className="text-[10px] uppercase text-brand-muted">Pinned commit</span><div className="mt-1 flex items-center justify-between"><code className="text-xs text-white">{truncateHash(release.commit, 9, 7)}</code><CopyButton text={release.commit} /></div></div>
              <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border"><span className="text-[10px] uppercase text-brand-muted">Artifact</span><div className="mt-1 flex items-center justify-between gap-2"><code className="text-xs text-white truncate">{release.artifactName}</code><CopyButton text={release.artifactName} /></div></div>
              <div className="p-3 rounded-lg bg-brand-bg-deep/60 border border-brand-border"><span className="text-[10px] uppercase text-brand-muted">Candidate SHA-256</span><div className="mt-1 flex items-center justify-between"><code className="text-xs text-white">{truncateHash(release.publishedArtifactHash, 9, 7)}</code><CopyButton text={release.publishedArtifactHash} /></div></div>
            </div>

            {verification.auditChainHash && <div className="rounded-lg bg-brand-bg-deep/50 border border-brand-border p-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs text-brand-muted"><Link2 className="w-4 h-4" />Audit chain head</div><div className="flex items-center gap-2"><code className="text-xs text-quorum-green-light">{truncateHash(verification.auditChainHash, 14, 10)}</code><CopyButton text={verification.auditChainHash} /></div></div>}

            <div className="p-3 rounded-lg bg-quorum-blue-bg/30 border border-quorum-blue-border/50 text-xs text-brand-muted flex items-start gap-2"><Info className="w-4 h-4 text-quorum-blue-light flex-shrink-0" /><span>A valid signature identifies a builder; reproducible agreement between independent builders is what establishes artifact trust.</span></div>
          </div>
        )}
      </div>

      <VerificationProgressModal isOpen={isVerifyingModalOpen} onComplete={handleModalFinished} targetPackage={`${release.name} (${release.version})`} />
    </div>
  );
};
