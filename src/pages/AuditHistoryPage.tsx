import React, { useEffect, useState } from 'react';
import { AuditTimelineFull } from '../components/audit/AuditTimelineFull';
import { AuditMetadataCard } from '../components/audit/AuditMetadataCard';
import { AuditEvent, AuditReport } from '../types';
import { api } from '../services/api';
import { Card, CardHeader, CardBody } from '../components/common/Card';
import { ScrollText, ShieldCheck, Filter, Download } from 'lucide-react';

export const AuditHistoryPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    Promise.all([api.getAuditEvents('rel-hey-01'), api.getAudit('rel-hey-01')]).then(
      ([evts, rep]) => {
        setEvents(evts);
        setReport(rep);
        setLoading(false);
      }
    );
  }, []);

  const filteredEvents = events.filter((e) => {
    if (filterType === 'all') return true;
    if (filterType === 'attestation') return e.type === 'ATTESTATION_SUBMITTED';
    if (filterType === 'consensus') return e.type === 'QUORUM_EVALUATED' || e.type === 'DECISION_FINALIZED';
    if (filterType === 'conflict') return e.type === 'CONFLICT_DETECTED';
    return true;
  });

  if (loading || !report) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full border-2 border-quorum-green border-t-transparent animate-spin mx-auto" />
          <p className="text-xs font-mono text-brand-muted">Retrieving on-chain audit ledger...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-quorum-green" />
            Immutable Audit Trail & Provenance
          </h2>
          <p className="text-xs text-brand-muted mt-1">
            Chronological cryptographic log of build dispatches, attestations, signatures, and smart contract anchoring.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-brand-panel border border-brand-border text-xs font-mono">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'all'
                ? 'bg-brand-panel-elevated text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            All Events
          </button>
          <button
            onClick={() => setFilterType('attestation')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'attestation'
                ? 'bg-brand-panel-elevated text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Attestations
          </button>
          <button
            onClick={() => setFilterType('conflict')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'conflict'
                ? 'bg-brand-panel-elevated text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Conflicts
          </button>
          <button
            onClick={() => setFilterType('consensus')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              filterType === 'consensus'
                ? 'bg-brand-panel-elevated text-white font-semibold'
                : 'text-brand-muted hover:text-white'
            }`}
          >
            Settlement
          </button>
        </div>
      </div>

      {/* Main Grid: Audit Timeline (2 cols) + Audit Metadata Card (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Timeline (Left 2 cols) */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title={`Chronological Event Sequence (${filteredEvents.length} Events)`}
              subtitle="Ordered deterministic records indexed by timestamp"
              icon={<ShieldCheck className="w-4 h-4 text-quorum-green" />}
            />
            <CardBody>
              <AuditTimelineFull events={filteredEvents} />
            </CardBody>
          </Card>
        </div>

        {/* Audit Metadata Card with Download JSON (Right 1 col) */}
        <div className="lg:col-span-1">
          <AuditMetadataCard report={report} />
        </div>
      </div>
    </div>
  );
};
