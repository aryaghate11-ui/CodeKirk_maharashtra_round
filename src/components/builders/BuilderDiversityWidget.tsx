import React from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Network, Server, ShieldCheck, Cpu } from 'lucide-react';
import { Builder } from '../../types';

interface BuilderDiversityWidgetProps {
  builders: Builder[];
}

export const BuilderDiversityWidget: React.FC<BuilderDiversityWidgetProps> = ({ builders }) => {
  return (
    <Card className="border-brand-border-bright/60">
      <CardHeader
        title="Registered Builder Evidence"
        subtitle="Identity, environment and signed attestation records"
        icon={<Network className="w-4 h-4 text-quorum-green" />}
        badge={
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-quorum-green-bg border border-quorum-green-border text-quorum-green-light">
            {builders.filter((b) => b.status === 'ATTESTED').length} Attested Builders
          </span>
        }
      />
      <CardBody className="space-y-4">
        <p className="text-xs text-brand-muted leading-relaxed">
          These are registered identities with signed evidence. “Attested” does not mean online or physically independent. Only builders carrying a PHYSICALLY INDEPENDENT label may be counted as externally proven devices/operators.
        </p>

        {/* Builder Environment Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {builders.slice(0, 3).map((b, idx) => (
            <div
              key={b.id}
              className="p-3.5 rounded-xl bg-brand-bg-deep/65 backdrop-blur-sm border border-brand-border/70 space-y-2 relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white font-mono flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-quorum-green" />
                  Node #{idx + 1}
                </span>
                <span className="text-[10px] font-mono text-quorum-green-light bg-quorum-green-bg px-1.5 py-0.5 rounded border border-quorum-green-border">
                  {b.shortCode}
                </span>
              </div>

              <div className="space-y-1 text-[11px] font-mono">
                <div className="text-white font-medium truncate">
                  {b.name}
                </div>
                <div className="text-brand-muted truncate text-[10px]">
                  {b.environment}
                </div>
              </div>

              <div className="pt-2 border-t border-brand-border/40 flex items-center justify-between text-[10px] text-brand-subtle">
                <span className="text-brand-muted">{b.operator}</span>
                <ShieldCheck className="w-3.5 h-3.5 text-quorum-green" />
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
};
