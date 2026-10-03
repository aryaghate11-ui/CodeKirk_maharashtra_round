import React, { useEffect, useState } from 'react';
import { AuditTimelineFull } from '../components/audit/AuditTimelineFull';
import { AuditMetadataCard } from '../components/audit/AuditMetadataCard';
import { AuditEvent, AuditReport, Release } from '../types';
import { api } from '../services/api';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { ScrollText, ShieldCheck, Filter, RefreshCw } from 'lucide-react';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';

export const AuditHistoryPage: React.FC = () => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>('rel-hey-01');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [apiError, setApiError] = useState<Error | string | null>(null);

  // Load all available releases
  useEffect(() => {
    api.getReleases()
      .then((rels) => {
        setReleases(rels);
        if (rels.length > 0) {
          setSelectedReleaseId(rels[0].id);
        }
      })
      .catch((err) => console.warn('Could not load releases for audit page', err));
  }, []);

  const loadAuditData = async (relId: string) => {
    setLoading(true);
    setApiError(null);
    try {
      const [evts, rep] = await Promise.all([
        api.getAuditEvents(relId),
        api.getAudit(relId),
      ]);
      setEvents(evts);
      setReport(rep);
    } catch (err: any) {
      console.error('Failed to load audit history', err);
      setApiError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedReleaseId) {
      loadAuditData(selectedReleaseId);
    }
  }, [selectedReleaseId]);

  const filteredEvents = events.filter((e) => {
    if (filterType === 'all') return true;
    if (filterType === 'attestation') return e.type === 'ATTESTATION_SUBMITTED';
    if (filterType === 'consensus') return e.type === 'QUORUM_EVALUATED' || e.type === 'DECISION_FINALIZED';
    if (filterType === 'conflict') return e.type === 'CONFLICT_DETECTED';
    return true;
  });

  return (
    <div className="space-y-6">
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          endpoint="/audit or /audit-events"
          onRetry={() => loadAuditData(selectedReleaseId)}
        />
      )}

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-quorum-green" />
            Audit History
          </h2>
          <p className="text-xs sm:text-sm text-brand-muted mt-1">
            Review the sequence of verification events recorded in the local hash-linked audit log.
          </p>
        </div>

        {/* Release selector dropdown */}
        {releases.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-brand-muted uppercase whitespace-nowrap">
              Release:
            </label>
            <select
              value={selectedReleaseId}
              onChange={(e) => setSelectedReleaseId(e.target.value)}
              className="bg-brand-panel-elevated/85 backdrop-blur-sm text-xs font-semibold text-white border border-brand-border-bright rounded-lg px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-quorum-green/50"
            >
              {releases.map((r) => (
                <option key={r.id} value={r.id} className="bg-brand-bg text-white py-1">
                  {r.name} ({r.version}) · {r.status}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter and Event Counter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-brand-panel/75 backdrop-blur-md border border-brand-border/70">
        <span className="text-xs text-brand-muted">
          Showing <strong className="text-white">{filteredEvents.length}</strong> recorded events for this release
        </span>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border text-xs font-mono">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterType === 'all'
                ? 'bg-brand-panel-elevated/85 text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            All Events
          </button>
          <button
            onClick={() => setFilterType('attestation')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterType === 'attestation'
                ? 'bg-brand-panel-elevated/85 text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Attestations
          </button>
          <button
            onClick={() => setFilterType('conflict')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterType === 'conflict'
                ? 'bg-brand-panel-elevated/85 text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Conflicts
          </button>
          <button
            onClick={() => setFilterType('consensus')}
            className={`px-3 py-1 rounded-md transition-colors ${
              filterType === 'consensus'
                ? 'bg-brand-panel-elevated/85 text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Final Decisions
          </button>
        </div>
      </div>

      {loading && !report ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 rounded-full border-2 border-quorum-green border-t-transparent animate-spin mx-auto" />
            <p className="text-xs font-mono text-brand-muted">Loading audit log...</p>
          </div>
        </div>
      ) : (
        /* Main Grid: Audit Timeline (2 cols) + Audit Metadata Card (1 col) */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Timeline (Left 2 cols) */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title={`Event Timeline (${filteredEvents.length})`}
                subtitle="Cryptographic audit sequence recorded in SQLite"
                icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />}
              />
              <CardBody>
                <AuditTimelineFull events={filteredEvents} />
              </CardBody>
            </Card>
          </div>

          {/* Audit Metadata Card with Download JSON (Right 1 col) */}
          {report && (
            <div className="lg:col-span-1">
              <AuditMetadataCard report={report} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
