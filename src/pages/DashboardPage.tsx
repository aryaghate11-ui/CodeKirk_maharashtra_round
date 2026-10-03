import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { MetricCard } from '../components/dashboard/MetricCard';
import { RecentReleasesTable } from '../components/dashboard/RecentReleasesTable';
import { ActivityTimeline } from '../components/dashboard/ActivityTimeline';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';
import { Release, SystemStats, AuditEvent } from '../types';
import { api } from '../services/api';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Server,
  Activity,
  ArrowRight,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { PageId } from '../components/layout/Sidebar';

interface DashboardPageProps {
  onNavigate: (page: PageId) => void;
  onSelectRelease: (releaseId: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onNavigate,
  onSelectRelease,
}) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<Error | string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setApiError(null);
      await api.detectBackend();
      const [rData, sData] = await Promise.all([
        api.getReleases(),
        api.getSystemStats(),
      ]);
      const eData = rData[0] && api.isBackendAvailable() ? await api.getAuditEvents(rData[0].id) : [];
      setReleases(rData);
      setEvents(eData);
      setStats(sData);
    } catch (err: any) {
      console.error('Failed to load dashboard data', err);
      setApiError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="space-y-8">
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          endpoint="/releases or /stats"
          onRetry={loadData}
        />
      )}
      {/* Hero Plain-English Value Proposition Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-brand-panel/80 via-brand-panel-elevated/75 to-brand-panel/80 backdrop-blur-md border border-brand-border-bright/70 shadow-panel relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-quorum-green-bg/80 border border-quorum-green-border/80 backdrop-blur-sm text-[11px] font-mono font-semibold text-quorum-green-light">
              <Sparkles className="w-3.5 h-3.5 text-quorum-green" />
              Software Supply-Chain Verification
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Can we trust this software?
            </h2>
            <p className="text-xs sm:text-sm text-brand-muted leading-relaxed">
              Quorum compares signed build evidence from multiple independent builders before a software release is trusted. If builders disagree or an artifact was modified, Quorum flags the risk immediately.
            </p>
          </div>

          <div className="flex flex-row md:flex-col gap-3 flex-shrink-0">
            <button
              onClick={() => onNavigate('verification')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-black bg-quorum-green hover:bg-quorum-green-light transition-all shadow-glow-green"
            >
              <span>Verify a Release</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate('attack-lab')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-brand-text bg-brand-panel-elevated/75 backdrop-blur-sm hover:bg-brand-panel/80 border border-brand-border transition-colors"
            >
              <span>Try an Attack Scenario</span>
            </button>
          </div>
        </div>
      </div>

      {/* Top 4 Real Backend Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Verified Releases"
          value={stats ? stats.releasesVerified : (loading ? '...' : 0)}
          subtext="Unanimous or threshold quorum met"
          icon={<ShieldCheck className="w-5 h-5 text-quorum-green" />}
          variant="green"
        />

        <MetricCard
          label="Rejected Releases"
          value={stats ? stats.releasesRejected : (loading ? '...' : 0)}
          subtext="Tampered binaries or mismatch"
          icon={<ShieldAlert className="w-5 h-5 text-quorum-red" />}
          variant="red"
        />

        <MetricCard
          label="Conflicts Detected"
          value={stats ? stats.conflictsDetected : (loading ? '...' : 0)}
          subtext="Builder divergence isolated"
          icon={<AlertTriangle className="w-5 h-5 text-quorum-amber" />}
          variant="amber"
        />

        <MetricCard
          label="Active Builders"
          value={stats ? stats.activeBuilders : (loading ? '...' : 0)}
          subtext="Independent build nodes online"
          icon={<Server className="w-5 h-5 text-quorum-blue-light" />}
          variant="blue"
        />
      </div>

      {/* Main Grid: Recent Releases (Left) + Verification Activity Timeline (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Recent Releases Table (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader
              title="Recent Releases"
              subtitle="Software packages evaluated against independent builder consensus"
              icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />}
              action={
                <button
                  onClick={() => onNavigate('verification')}
                  className="text-xs text-quorum-green-light hover:underline font-mono font-medium flex items-center gap-1"
                >
                  View Verifier <ArrowRight className="w-3 h-3" />
                </button>
              }
            />
            <RecentReleasesTable
              releases={releases}
              onSelectRelease={(id) => {
                onSelectRelease(id);
                onNavigate('verification');
              }}
            />
          </Card>
        </div>

        {/* Recent Verification Activity (1 col) */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Recent Activity"
              subtitle="Audit events recorded by the verification engine"
              icon={<Activity className="w-4 h-4 text-quorum-blue-light" />}
              badge={
                <span className="w-2 h-2 rounded-full bg-quorum-green animate-pulse" />
              }
            />
            <CardBody>
              <ActivityTimeline events={events} maxEvents={5} />

              <div className="mt-6 pt-4 border-t border-brand-border/60">
                <button
                  onClick={() => onNavigate('audit')}
                  className="w-full text-center text-xs font-mono text-brand-muted hover:text-white transition-colors"
                >
                  View Full Audit History →
                </button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
};
