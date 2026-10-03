import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Network, Server, Layers, Cpu, ShieldCheck } from 'lucide-react';
import { Builder } from '../../types';

interface BuilderDiversityWidgetProps {
  builders: Builder[];
}

export const BuilderDiversityWidget: React.FC<BuilderDiversityWidgetProps> = ({ builders }) => {
  return (
    <Card className="border-brand-border-bright/60">
      <CardHeader
        title="Multi-Environment Consensus Topology"
        subtitle="Zero single-point-of-failure infrastructure diversity"
        icon={<Network className="w-4 h-4 text-quorum-green" />}
        badge={
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-quorum-green-bg border border-quorum-green-border text-quorum-green-light">
            100% Isolated
          </span>
        }
      />
      <CardBody className="space-y-6">
        <p className="text-xs text-brand-muted leading-relaxed">
          Quorum enforces hardware and hypervisor divergence. A compiler backdoor or glibc vulnerability specific to one container engine cannot compromise unanimous quorum.
        </p>

        {/* Minimalist Topology Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {builders.slice(0, 3).map((b, idx) => (
            <div
              key={b.id}
              className="p-3.5 rounded-xl bg-brand-bg-deep/80 border border-brand-border space-y-2 relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white font-mono flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-quorum-green" />
                  Node #{idx + 1}
                </span>
                <span className="text-[10px] font-mono text-quorum-green-light bg-quorum-green-bg px-1.5 py-0.2 rounded border border-quorum-green-border">
                  {b.shortCode}
                </span>
              </div>

              <div className="space-y-1 text-[11px] font-mono">
                <div className="text-brand-muted truncate">
                  OS: <span className="text-white">{b.os.split('(')[0].trim()}</span>
                </div>
                <div className="text-brand-muted truncate">
                  Sandbox: <span className="text-white">{b.environment.split(' ')[0]}</span>
                </div>
                <div className="text-brand-muted truncate">
                  Uptime: <span className="text-quorum-green-light">{b.uptime}%</span>
                </div>
              </div>

              <div className="pt-2 border-t border-brand-border/40 flex items-center justify-between text-[10px] text-brand-subtle">
                <span>{b.region.split('(')[0].trim()}</span>
                <ShieldCheck className="w-3.5 h-3.5 text-quorum-green" />
              </div>
            </div>
          ))}
        </div>

        {/* Diversity Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
          <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
            <span className="text-[10px] font-mono text-brand-muted uppercase block">
              OS Diversity
            </span>
            <span className="font-mono text-sm font-semibold text-white">3 Distinct</span>
          </div>

          <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
            <span className="text-[10px] font-mono text-brand-muted uppercase block">
              Container Runtimes
            </span>
            <span className="font-mono text-sm font-semibold text-white">Docker / Podman / MicroVM</span>
          </div>

          <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
            <span className="text-[10px] font-mono text-brand-muted uppercase block">
              Cloud Diversity
            </span>
            <span className="font-mono text-sm font-semibold text-white">AWS · GCP · Hetzner</span>
          </div>

          <div className="p-2.5 rounded-lg bg-brand-panel-elevated/40 border border-brand-border">
            <span className="text-[10px] font-mono text-brand-muted uppercase block">
              Consensus Health
            </span>
            <span className="font-mono text-sm font-semibold text-quorum-green-light">99.1% Agree</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
