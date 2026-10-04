import React from 'react';
import { Box, CheckCircle2, Clock3, GitCommit, Hash, ShieldAlert } from 'lucide-react';
import { Builder, BuilderBuild } from '../../types';
import { Badge } from '../common/Badge';
import { CopyButton } from '../common/CopyButton';
import { formatRelativeTime, truncateHash } from '../../lib/utils';

interface BuilderBuildHistoryProps {
  builder: Builder;
  builds: BuilderBuild[];
  loading: boolean;
}

const statusTone = (build: BuilderBuild): 'green' | 'amber' | 'red' | 'slate' => {
  if (!build.signatureValid || build.releaseStatus === 'rejected') return 'red';
  if (build.releaseStatus === 'disagreement' || build.matchesConsensus === false) return 'amber';
  if (build.releaseStatus === 'verified' && build.matchesConsensus) return 'green';
  return 'slate';
};

export const BuilderBuildHistory: React.FC<BuilderBuildHistoryProps> = ({ builder, builds, loading }) => (
  <section className="rounded-xl border border-brand-border/70 bg-brand-panel/70 backdrop-blur-md overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3.5 border-b border-brand-border/60">
      <div>
        <h4 className="text-sm font-bold text-white">{builder.name} output</h4>
        <p className="text-xs text-brand-muted">Artifacts recorded from accepted signed attestations.</p>
      </div>
      <Badge variant={builds.length ? 'green' : 'slate'} size="sm">
        {builds.length} {builds.length === 1 ? 'BUILD' : 'BUILDS'}
      </Badge>
    </div>

    {loading ? (
      <div className="p-5 text-sm text-brand-muted">Loading real builder evidence…</div>
    ) : builds.length === 0 ? (
      <div className="p-5 flex items-start gap-3">
        <Clock3 className="w-5 h-5 text-quorum-amber mt-0.5" />
        <div><p className="text-sm text-white">No build submitted yet</p><p className="text-xs text-brand-muted mt-1">This builder is registered, but the backend has no accepted artifact evidence from it.</p></div>
      </div>
    ) : (
      <div className="divide-y divide-brand-border/50">
        {builds.map((build) => (
          <article key={`${build.releaseId}-${build.evidenceDigest}`} className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Box className="w-4 h-4 text-quorum-green" />
                  <span className="text-sm font-semibold text-white">{build.artifactName}</span>
                  <Badge variant={statusTone(build)} size="sm" dot>{build.releaseStatus.toUpperCase()}</Badge>
                  <Badge variant={build.signatureValid ? 'green' : 'red'} size="sm">
                    {build.signatureValid ? 'SIGNATURE VALID' : 'INVALID SIGNATURE'}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-brand-muted truncate" title={build.repositoryUrl}>{build.repositoryUrl}</p>
              </div>
              <span className="text-[11px] text-brand-subtle whitespace-nowrap">{formatRelativeTime(build.builtAt)}</span>
            </div>

            <div className="mt-3 grid md:grid-cols-2 xl:grid-cols-4 gap-2 text-[11px]">
              <div className="rounded-lg bg-brand-bg-deep/60 border border-brand-border/60 p-2.5">
                <span className="text-brand-subtle flex items-center gap-1"><Hash className="w-3 h-3" /> Built artifact SHA-256</span>
                <div className="mt-1 flex items-center gap-1 font-mono text-brand-text"><span>{truncateHash(build.artifactSha256, 9, 7)}</span><CopyButton text={build.artifactSha256} title="Copy artifact hash" /></div>
              </div>
              <div className="rounded-lg bg-brand-bg-deep/60 border border-brand-border/60 p-2.5">
                <span className="text-brand-subtle flex items-center gap-1"><GitCommit className="w-3 h-3" /> Source commit</span>
                <div className="mt-1 flex items-center gap-1 font-mono text-brand-text"><span>{truncateHash(build.sourceCommit, 9, 7)}</span><CopyButton text={build.sourceCommit} title="Copy source commit" /></div>
              </div>
              <div className="rounded-lg bg-brand-bg-deep/60 border border-brand-border/60 p-2.5">
                <span className="text-brand-subtle">Consensus comparison</span>
                <p className={`mt-1 font-semibold ${build.matchesConsensus === true ? 'text-quorum-green-light' : build.matchesConsensus === false ? 'text-quorum-amber-light' : 'text-brand-muted'}`}>
                  {build.matchesConsensus === true ? 'Exact hash match' : build.matchesConsensus === false ? 'Hash conflict' : 'Awaiting consensus'}
                </p>
              </div>
              <div className="rounded-lg bg-brand-bg-deep/60 border border-brand-border/60 p-2.5">
                <span className="text-brand-subtle">Publisher candidate</span>
                <p className={`mt-1 flex items-center gap-1 font-semibold ${build.matchesCandidate ? 'text-quorum-green-light' : 'text-quorum-red-light'}`}>
                  {build.matchesCandidate ? <CheckCircle2 className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                  {build.matchesCandidate ? 'Matches candidate' : 'Does not match'}
                </p>
              </div>
            </div>
            <details className="mt-3 text-[11px]">
              <summary className="cursor-pointer text-brand-muted hover:text-white">Technical evidence</summary>
              <div className="mt-2 rounded-lg border border-brand-border/60 bg-brand-bg-deep/50 p-3 font-mono text-brand-subtle break-all space-y-1">
                <p>Release: {build.releaseId}</p>
                <p>Environment: {build.environment}</p>
                <p>Schema: {build.attestationSchema}</p>
                <p>Evidence digest: {build.evidenceDigest}</p>
              </div>
            </details>
          </article>
        ))}
      </div>
    )}
  </section>
);
