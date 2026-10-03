import React, { useEffect, useState } from 'react';
import { BuilderCard } from '../components/builders/BuilderCard';
import { BuilderDiversityWidget } from '../components/builders/BuilderDiversityWidget';
import { Builder } from '../types';
import { api } from '../services/api';
import { Server, ShieldCheck, Cpu, HardDrive } from 'lucide-react';
import { Card, CardHeader, CardBody } from '../components/common/Card';

export const BuildersPage: React.FC = () => {
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBuilders().then((data) => {
      setBuilders(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Topology & Architecture Widget */}
      <BuilderDiversityWidget builders={builders} />

      {/* Builders Grid Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Server className="w-4 h-4 text-quorum-green" />
            Independent Witness Nodes
          </h3>
          <p className="text-xs text-brand-muted mt-0.5">
            Decentralized node operators executing hermetic reproducible builds from pinned source commits.
          </p>
        </div>

        <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-brand-panel-elevated border border-brand-border text-quorum-green-light">
          {builders.filter((b) => b.status === 'ONLINE').length} / {builders.length} Online
        </span>
      </div>

      {/* Builders Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
        {builders.map((builder, idx) => (
          <BuilderCard key={builder.id} builder={builder} index={idx} />
        ))}
      </div>

      {/* Security Note on Operator Independence */}
      <div className="p-4 rounded-xl bg-brand-panel/60 border border-brand-border text-xs text-brand-muted space-y-2">
        <h4 className="font-semibold text-white flex items-center gap-1.5 text-xs">
          <ShieldCheck className="w-4 h-4 text-quorum-green" />
          Why Multiple Independent Builders?
        </h4>
        <p className="leading-relaxed">
          Traditional CI/CD pipelines represent single points of failure (compromised credentials, compromised runner images, or targeted compiler backdoors like Ken Thompson's "Reflections on Trusting Trust"). Quorum requires distinct legal entities, cloud regions, and sandboxing runtimes (Docker, Podman, and Firecracker microVMs) to rebuild source code independently before cryptographic signing.
        </p>
      </div>
    </div>
  );
};
