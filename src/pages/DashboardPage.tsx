import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  GitCompare,
  Link2,
  Radio,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { RecentReleasesTable } from '../components/dashboard/RecentReleasesTable';
import { ActivityTimeline } from '../components/dashboard/ActivityTimeline';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import { Release, SystemStats, AuditEvent } from '../types';
import { api } from '../services/api';
import { truncateHash } from '../lib/utils';
import { PageId } from '../components/layout/Sidebar';

interface DashboardPageProps {
  onNavigate: (page: PageId) => void;
  onSelectRelease: (releaseId: string) => void;
}

interface TrustSignals {
  living: string;
  sentinel: string;
  relay: string;
  blockchain: string;
}

const initialSignals: TrustSignals = {
  living: 'Checking…',
  sentinel: 'Checking…',
  relay: 'Checking…',
  blockchain: 'Checking…',
};

const signalTone = (value: string): 'green' | 'amber' | 'red' | 'slate' => {
  if (/degraded|critical|high risk|mismatch|changed/i.test(value)) return 'red';
  if (/pending|not assessed|not anchored|no monitor|checking/i.test(value)) return 'amber';
  if (/verified|clear|match|anchored|active|info risk|low risk/i.test(value)) return 'green';
  return 'slate';
};

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate, onSelectRelease }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [signals, setSignals] = useState<TrustSignals>(initialSignals);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<Error | string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setApiError(null);
      await api.detectBackend();
      const [releaseData, statsData] = await Promise.all([api.getReleases(), api.getSystemStats()]);
      setReleases(releaseData);
      setStats(statsData);

      const latest = releaseData[0];
      if (!latest) {
        setEvents([]);
        setSignals({ living: 'No release', sentinel: 'No release', relay: 'No release', blockchain: 'No release' });
        return;
      }

      const [eventResult, livingResult, sentinelResult, relayResult, auditResult] = await Promise.allSettled([
        api.getAuditEvents(latest.id),
        api.getLivingReleases(),
        api.getSentinelComparisons(),
        api.getRelayMonitors(),
        api.getAudit(latest.id),
      ]);
      setEvents(eventResult.status === 'fulfilled' ? eventResult.value : []);

      const living = livingResult.status === 'fulfilled'
        ? livingResult.value.find((item) => item.release_id === latest.id)
        : undefined;
      const sentinel = sentinelResult.status === 'fulfilled'
        ? sentinelResult.value.find((item) => item.target_commit === latest.commit)
        : undefined;
      const monitors = relayResult.status === 'fulfilled'
        ? relayResult.value.filter((item) => item.release_id === latest.id)
        : [];
      const relayValue = monitors.some((item) => item.last_result === 'MISMATCH')
        ? 'Artifact mismatch'
        : monitors.some((item) => item.last_result === 'MATCH')
          ? 'Artifact matches'
          : monitors.length
            ? 'Monitoring active'
            : 'No monitor';

      setSignals({
        living: living?.current_status.replace('_', ' ') || 'Not assessed',
        sentinel: sentinel ? `${sentinel.risk_level} risk` : 'Not assessed',
        relay: relayValue,
        blockchain: auditResult.status === 'fulfilled' && auditResult.value.anchored ? 'Anchored' : 'Not anchored',
      });
    } catch (err: any) {
      setApiError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const currentRelease = releases[0];
  const trustDegraded = signals.living === 'TRUST DEGRADED';
  const effectiveStatus = trustDegraded ? 'TRUST DEGRADED' : currentRelease?.status || 'PENDING';
  const installationAllowed = effectiveStatus === 'ACCEPTED';
  const decisionTone = installationAllowed ? 'green' : effectiveStatus === 'PENDING' ? 'amber' : 'red';
  const decisionReason = trustDegraded
    ? 'New trust information means the original builder evidence no longer satisfies the required quorum.'
    : currentRelease?.decisionExplanation || 'Quorum is waiting for enough independently signed build evidence.';

  const trustCards = [
    { label: 'Living Verification', value: signals.living, icon: RefreshCcw, page: 'living' as PageId },
    { label: 'Source Sentinel', value: signals.sentinel, icon: GitCompare, page: 'sentinel' as PageId },
    { label: 'Quorum Relay', value: signals.relay, icon: Radio, page: 'relay' as PageId },
    { label: 'Blockchain', value: signals.blockchain, icon: Link2, page: 'audit' as PageId },
  ];

  return (
    <div className="space-y-5">
      {apiError && <ApiErrorBanner error={apiError} endpoint="/releases or /stats" onRetry={loadData} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <p className="text-sm text-brand-muted max-w-2xl">
          Quorum checks whether independent builders can reproduce the same software artifact from the same source.
        </p>
        <button onClick={() => onNavigate('verification')} className="inline-flex items-center gap-2 text-sm font-semibold text-quorum-green-light hover:text-quorum-green">
          Verify another release <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <Card glow={decisionTone} className="border-brand-border-bright">
        <CardBody className="p-5 sm:p-7">
          {loading && !currentRelease ? (
            <div className="min-h-[190px] grid place-items-center text-sm text-brand-muted">Loading current release…</div>
          ) : currentRelease ? (
            <div className="grid lg:grid-cols-[1fr_280px] gap-6 lg:gap-8">
              <div>
                <div className="flex items-center gap-2 text-xs text-brand-muted">
                  <Box className="w-4 h-4" /> Current release
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{currentRelease.name}</h2>
                  <span className="font-mono text-xs text-brand-muted">{currentRelease.version}</span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Badge variant={decisionTone} size="lg" dot pulse={effectiveStatus === 'PENDING'}>
                    {effectiveStatus === 'ACCEPTED' ? 'VERIFIED' : effectiveStatus}
                  </Badge>
                  <span className={`text-sm font-semibold ${installationAllowed ? 'text-quorum-green-light' : 'text-quorum-red-light'}`}>
                    {installationAllowed ? 'Installation allowed' : 'Installation blocked'}
                  </span>
                </div>
                <p className="mt-3 text-sm text-brand-muted leading-relaxed max-w-2xl">{decisionReason}</p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => onSelectRelease(currentRelease.id)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-quorum-green text-black text-sm font-bold hover:bg-quorum-green-light shadow-glow-green"
                  >
                    View verification <ArrowRight className="w-4 h-4" />
                  </button>
                  <button onClick={() => onNavigate('audit')} className="px-4 py-2.5 rounded-lg border border-brand-border-bright bg-brand-panel-elevated/60 text-sm font-semibold text-white hover:border-quorum-green-border">
                    View evidence
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-brand-bg-deep/65 border border-brand-border/70 p-5 flex flex-col justify-center">
                <span className="text-[11px] uppercase tracking-wider text-brand-subtle">Builder consensus</span>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-4xl font-bold text-white">{currentRelease.agreement}</span>
                  <span className="text-lg text-brand-muted mb-1">of {currentRelease.totalBuilders}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-brand-panel-elevated overflow-hidden">
                  <div className={`h-full ${installationAllowed ? 'bg-quorum-green' : 'bg-quorum-amber'}`} style={{ width: `${currentRelease.totalBuilders ? (currentRelease.agreement / currentRelease.totalBuilders) * 100 : 0}%` }} />
                </div>
                <p className="mt-3 text-xs text-brand-muted">
                  Required policy: {currentRelease.policy.k} of {currentRelease.policy.n} matching builders
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs font-mono text-brand-subtle">
                  <span>SHA-256</span><span className="text-brand-text">{truncateHash(currentRelease.publishedArtifactHash, 10, 7)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-h-[190px] grid place-items-center text-center">
              <div><ShieldAlert className="w-8 h-8 mx-auto text-quorum-amber" /><p className="mt-3 text-sm text-white">No releases have been registered yet.</p></div>
            </div>
          )}
        </CardBody>
      </Card>

      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <div><h3 className="text-sm font-bold text-white">Security & trust</h3><p className="text-xs text-brand-muted mt-0.5">Four checks that support the current release decision.</p></div>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {trustCards.map((item) => {
            const Icon = item.icon;
            const tone = signalTone(item.value);
            return (
              <button key={item.label} onClick={() => onNavigate(item.page)} className="text-left rounded-xl border border-brand-border/70 bg-brand-panel/70 backdrop-blur-md p-4 hover:border-brand-border-bright hover:bg-brand-panel-elevated/60 transition-all">
                <div className="flex items-center justify-between"><Icon className="w-4 h-4 text-brand-muted" /><ArrowRight className="w-3.5 h-3.5 text-brand-subtle" /></div>
                <p className="mt-3 text-xs text-brand-muted">{item.label}</p>
                <div className="mt-1"><Badge variant={tone} size="sm" dot>{item.value}</Badge></div>
              </button>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader title="Recent releases" subtitle="Select a release to inspect its decision" icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />} />
        <RecentReleasesTable releases={releases.slice(0, 5)} onSelectRelease={onSelectRelease} />
      </Card>

      <details className="group rounded-xl border border-brand-border/70 bg-brand-panel/60 backdrop-blur-md">
        <summary className="list-none cursor-pointer p-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><Activity className="w-4 h-4 text-brand-muted" /><div><p className="text-sm font-semibold text-white">System activity & totals</p><p className="text-xs text-brand-muted">Secondary operational information</p></div></div>
          <ChevronDown className="w-4 h-4 text-brand-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-brand-border/60 p-4 grid lg:grid-cols-[1fr_2fr] gap-5">
          <div className="grid grid-cols-2 gap-3 self-start">
            {[
              ['Verified', stats?.releasesVerified ?? 0, CheckCircle2, 'text-quorum-green'],
              ['Rejected', stats?.releasesRejected ?? 0, ShieldAlert, 'text-quorum-red'],
              ['Conflicts', stats?.conflictsDetected ?? 0, AlertTriangle, 'text-quorum-amber'],
              ['Builders', stats?.activeBuilders ?? 0, Users, 'text-quorum-blue-light'],
            ].map(([label, value, Icon, color]: any) => <div key={label} className="rounded-lg bg-brand-bg-deep/60 border border-brand-border/60 p-3"><Icon className={`w-4 h-4 ${color}`} /><p className="mt-2 text-xl font-bold text-white">{value}</p><p className="text-xs text-brand-muted">{label}</p></div>)}
          </div>
          <div><ActivityTimeline events={events} maxEvents={5} /><button onClick={() => onNavigate('audit')} className="mt-4 text-xs text-quorum-green-light hover:underline">Open full audit history →</button></div>
        </div>
      </details>
    </div>
  );
};
