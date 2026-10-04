import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { truncateHash, formatRelativeTime } from '../lib/utils';
import { api } from '../services/api';
import {
  IncidentAction,
  LivingAssessment,
  LivingBuilder,
  LivingIncident,
  LivingStats,
} from '../types/living';

export const LivingVerificationPage: React.FC = () => {
  const [stats, setStats] = useState<LivingStats | null>(null);
  const [builders, setBuilders] = useState<LivingBuilder[]>([]);
  const [assessments, setAssessments] = useState<LivingAssessment[]>([]);
  const [incidents, setIncidents] = useState<LivingIncident[]>([]);
  const [selectedBuilder, setSelectedBuilder] = useState('');
  const [reason, setReason] = useState('Private signing key was reported compromised.');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [nextStats, nextBuilders, nextReleases, nextIncidents] = await Promise.all([
        api.getLivingStats(),
        api.getLivingBuilders(),
        api.getLivingReleases(),
        api.getLivingIncidents(),
      ]);
      setStats(nextStats);
      setBuilders(nextBuilders);
      setAssessments(nextReleases);
      setIncidents(nextIncidents);
      if (!selectedBuilder && nextBuilders.length) setSelectedBuilder(nextBuilders[0].id);
    } catch (err: any) {
      setError(err.message || 'Living Verification could not reach the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selected = builders.find((builder) => builder.id === selectedBuilder);
  const action: IncidentAction = selected?.living_status === 'COMPROMISED' ? 'REINSTATED' : 'COMPROMISED';
  const degraded = useMemo(
    () => assessments.filter((release) => release.current_status === 'TRUST_DEGRADED'),
    [assessments]
  );

  const submitIncident = async () => {
    if (!selectedBuilder || reason.trim().length < 5) return;
    try {
      setSubmitting(true);
      setError(null);
      const result = await api.createLivingIncident({
        builder_id: selectedBuilder,
        action,
        reason: reason.trim(),
        effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
      });
      setNotice(
        `${result.incident.action}: ${result.affected_releases} releases re-evaluated, ` +
        `${result.degraded_releases} currently degraded.`
      );
      await load();
    } catch (err: any) {
      setError(err.message || 'The trust incident could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  const runReevaluation = async () => {
    try {
      setSubmitting(true);
      setError(null);
      const result = await api.reevaluateLivingReleases();
      setNotice(`${result.reevaluated} releases re-evaluated; ${result.trust_degraded} are trust degraded.`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Re-evaluation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card glow={stats?.trust_degraded ? 'amber' : 'green'}>
        <CardBody className="p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl border ${stats?.trust_degraded ? 'bg-quorum-amber-bg border-quorum-amber-border' : 'bg-quorum-green-bg border-quorum-green-border'}`}>
                {stats?.trust_degraded ? <ShieldAlert className="w-7 h-7 text-quorum-amber" /> : <ShieldCheck className="w-7 h-7 text-quorum-green" />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white">Trust is a living decision</h2>
                  <Badge variant={stats?.incident_chain.valid ? 'green' : 'red'} size="sm" dot>
                    INCIDENT CHAIN {stats?.incident_chain.valid ? 'VALID' : 'INVALID'}
                  </Badge>
                </div>
                <p className="text-sm text-brand-muted mt-1 max-w-2xl">
                  Historical signatures remain unchanged. Quorum continuously recalculates whether those signatures are still sufficient under today&apos;s trust information.
                </p>
              </div>
            </div>
            <button onClick={runReevaluation} disabled={submitting} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-panel-elevated border border-brand-border text-sm text-white hover:border-quorum-green-border disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} /> Re-evaluate all releases
            </button>
          </div>
        </CardBody>
      </Card>

      {error && <div className="rounded-xl border border-quorum-red-border bg-quorum-red-bg/70 p-4 text-sm text-quorum-red-light">{error}</div>}
      {notice && <div className="rounded-xl border border-quorum-blue-border bg-quorum-blue-bg/60 p-4 text-sm text-quorum-blue-light">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Releases watched', stats?.total_releases ?? 0, Activity, 'blue'],
          ['Currently verified', stats?.currently_verified ?? 0, CheckCircle2, 'green'],
          ['Trust degraded', stats?.trust_degraded ?? 0, AlertTriangle, 'amber'],
          ['Active compromises', stats?.active_compromises ?? 0, KeyRound, 'red'],
        ].map(([label, value, Icon, tone]: any) => (
          <Card key={label}>
            <CardBody className="p-4">
              <div className="flex items-center justify-between">
                <div><p className="text-[11px] uppercase tracking-wider text-brand-subtle">{label}</p><p className="text-2xl font-bold text-white mt-1">{value}</p></div>
                <Icon className={`w-5 h-5 text-quorum-${tone}`} />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Record new trust information" subtitle="Compromise or reinstate a builder identity" icon={<KeyRound className="w-4 h-4 text-quorum-amber" />} />
          <CardBody className="space-y-4">
            <label className="block"><span className="text-xs text-brand-muted">Builder</span>
              <select value={selectedBuilder} onChange={(event) => setSelectedBuilder(event.target.value)} className="mt-1.5 w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2.5 text-sm text-white">
                {builders.map((builder) => <option key={builder.id} value={builder.id}>{builder.name} · {builder.living_status}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs text-brand-muted">Known compromised since (optional)</span>
              <input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={action === 'REINSTATED'} className="mt-1.5 w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2.5 text-sm text-white disabled:opacity-40" />
            </label>
            <label className="block"><span className="text-xs text-brand-muted">Evidence / reason</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1.5 w-full bg-brand-bg-deep border border-brand-border rounded-lg p-2.5 text-sm text-white resize-none" />
            </label>
            <button onClick={submitIncident} disabled={submitting || loading || !selectedBuilder} className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${action === 'COMPROMISED' ? 'bg-quorum-red text-white' : 'bg-quorum-green text-black'}`}>
              {action === 'COMPROMISED' ? <ShieldAlert className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
              {action === 'COMPROMISED' ? 'Mark builder compromised' : 'Reinstate after review'}
            </button>
            <p className="text-[11px] text-brand-subtle">This creates a hash-chained incident and immediately recalculates every affected release. Existing signatures are never deleted.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3" glow={degraded.length ? 'amber' : 'none'}>
          <CardHeader title="Current release trust" subtitle="Historical verdict compared with today’s evidence" icon={<Activity className="w-4 h-4 text-quorum-blue" />} badge={<Badge variant={degraded.length ? 'amber' : 'green'} size="sm">{degraded.length} DEGRADED</Badge>} />
          <CardBody className="p-0">
            <div className="max-h-[430px] overflow-auto divide-y divide-brand-border/60">
              {loading ? <div className="p-8 text-center text-sm text-brand-muted">Re-evaluating release history…</div> : assessments.length === 0 ? <div className="p-8 text-center text-sm text-brand-muted">No releases are available yet.</div> : assessments.map((release) => (
                <div key={release.release_id} className="p-4 hover:bg-brand-panel-elevated/25">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-sm font-semibold text-white truncate">{release.artifact_name}</p><p className="text-[11px] font-mono text-brand-subtle mt-1">{truncateHash(release.release_id, 10, 6)}</p></div>
                    <Badge variant={release.current_status === 'TRUST_DEGRADED' ? 'amber' : release.current_status === 'VERIFIED' ? 'green' : 'slate'} size="sm" dot>{release.current_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div><span className="text-brand-subtle block">Historical</span><span className="text-brand-text uppercase">{release.historical_status}</span></div>
                    <div><span className="text-brand-subtle block">Evidence now</span><span className="text-brand-text">{release.eligible_attestation_count}/{release.original_attestation_count}</span></div>
                    <div><span className="text-brand-subtle block">Required</span><span className="text-brand-text">{release.threshold} builders</span></div>
                  </div>
                  {release.excluded_builders.length > 0 && <p className="text-[11px] text-quorum-amber-light mt-2">Excluded: {release.excluded_builders.join(', ')}</p>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Trust incident history" subtitle="Tamper-evident changes to what Quorum knows" icon={<History className="w-4 h-4 text-quorum-green" />} badge={<span className="text-[10px] font-mono text-brand-subtle">HEAD {truncateHash(stats?.incident_chain.chain_head || 'No incidents', 10, 6)}</span>} />
        <CardBody className="p-0">
          <div className="divide-y divide-brand-border/60">
            {incidents.length === 0 ? <div className="p-7 text-center text-sm text-brand-muted">No compromise incidents have been recorded.</div> : incidents.map((incident) => (
              <div key={incident.id} className="p-4 grid md:grid-cols-[1fr_1.5fr_auto] gap-3 md:items-center">
                <div className="flex items-center gap-3"><Clock3 className="w-4 h-4 text-brand-subtle" /><div><p className="text-sm text-white">{incident.builder_name}</p><p className="text-[11px] text-brand-subtle">{formatRelativeTime(incident.created_at)}</p></div></div>
                <p className="text-xs text-brand-muted">{incident.reason}</p>
                <Badge variant={incident.action === 'COMPROMISED' ? 'red' : 'green'} size="sm">{incident.action}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
