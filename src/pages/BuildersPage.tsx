import React, { useEffect, useState } from 'react';
import { BuilderCard } from '../components/builders/BuilderCard';
import { BuilderDiversityWidget } from '../components/builders/BuilderDiversityWidget';
import { Builder } from '../types';
import { api } from '../services/api';
import { Server, ShieldCheck, AlertCircle } from 'lucide-react';
import { ApiErrorBanner } from '../components/common/ApiErrorBanner';

export const BuildersPage: React.FC = () => {
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<Error | string | null>(null);

  const loadBuilders = async () => {
    setLoading(true);
    setApiError(null);
    try {
      const data = await api.getBuilders();
      setBuilders(data);
    } catch (err: any) {
      console.error('Failed to load builders', err);
      setApiError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBuilders();
  }, []);

  return (
    <div className="space-y-6">
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          endpoint="/builders"
          onRetry={loadBuilders}
        />
      )}

      {/* Page Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
          <Server className="w-5 h-5 text-quorum-green" />
          Builders
        </h2>
        <p className="text-xs sm:text-sm text-brand-muted mt-1">
          Different builders independently submit signed evidence about the same software release.
        </p>
      </div>

      {/* Builder Diversity & Topology */}
      <BuilderDiversityWidget builders={builders} />

      {/* Builders Grid Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">
            Registered Builder Nodes
          </h3>
          <p className="text-xs text-brand-muted mt-0.5">
            Nodes independently compile source commits and generate Ed25519-signed build attestations.
          </p>
        </div>

        <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-brand-panel-elevated/75 backdrop-blur-sm border border-brand-border/70 text-quorum-green-light">
          {builders.filter((b) => b.status === 'ONLINE').length} / {builders.length} Online
        </span>
      </div>

      {/* Builders Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {builders.map((builder, idx) => (
          <BuilderCard key={builder.id} builder={builder} index={idx} />
        ))}
      </div>

      {/* Security Note on Operator Independence */}
      <div className="p-4 rounded-xl bg-brand-panel/75 backdrop-blur-md border border-brand-border/70 text-xs text-brand-muted space-y-2">
        <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
          <ShieldCheck className="w-4 h-4 text-quorum-green" />
          Why Multiple Independent Builders?
        </h4>
        <p className="leading-relaxed">
          Traditional CI/CD pipelines represent single points of failure (e.g. compromised runner credentials, modified dependencies, or malicious build servers). Quorum requires distinct witness nodes running separate environments (such as GitHub Actions, Podman, and self-hosted instances) to compile source code independently before a release is trusted.
        </p>
      </div>
    </div>
  );
};
