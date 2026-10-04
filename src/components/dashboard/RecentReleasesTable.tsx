import React from 'react';
import { Release } from '../../types';
import { DecisionBadge } from '../common/Badge';
import { CopyButton } from '../common/CopyButton';
import { truncateHash, formatRelativeTime } from '../../lib/utils';
import { ExternalLink, ShieldCheck, ArrowRight } from 'lucide-react';

interface RecentReleasesTableProps {
  releases: Release[];
  onSelectRelease: (releaseId: string) => void;
}

export const RecentReleasesTable: React.FC<RecentReleasesTableProps> = ({
  releases,
  onSelectRelease,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-brand-border/70 text-brand-muted uppercase tracking-wider text-[11px] bg-brand-panel-elevated/40">
            <th className="py-3 px-4 font-semibold">Package</th>
            <th className="py-3 px-4 font-semibold">Version</th>
            <th className="py-3 px-4 font-semibold text-center">Attestations</th>
            <th className="py-3 px-4 font-semibold">Original quorum</th>
            <th className="py-3 px-4 font-semibold text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border/40">
          {releases.map((rel) => {
            const isPassing = rel.agreement >= rel.policy.k;
            return (
              <tr
                key={rel.id}
                onClick={() => onSelectRelease(rel.id)}
                className="hover:bg-brand-panel-elevated/40 cursor-pointer transition-colors duration-150 group"
              >
                {/* Package */}
                <td className="py-3.5 px-4 min-w-[200px]">
                  <div className="font-semibold text-white group-hover:text-quorum-green-light transition-colors text-sm">
                    {rel.name}
                  </div>
                  <div className="text-[11px] text-brand-muted font-mono truncate max-w-[220px] flex items-center gap-1 mt-0.5">
                    <span>{rel.repo}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </div>
                </td>

                {/* Version */}
                <td className="py-3.5 px-4 font-mono font-medium text-brand-text">
                  <span className="px-2.5 py-1 rounded bg-brand-bg-deep/70 backdrop-blur-sm border border-brand-border/70 text-xs text-white">
                    {rel.version}
                  </span>
                </td>

                {/* Attestations Agreement */}
                <td className="py-3.5 px-4 text-center">
                  <span
                    className={`font-mono text-xs font-semibold px-2.5 py-1 rounded inline-flex items-center gap-1 backdrop-blur-sm ${
                      isPassing
                        ? 'bg-quorum-green-bg/80 text-quorum-green-light border border-quorum-green-border/80'
                        : 'bg-quorum-amber-bg/80 text-quorum-amber-light border border-quorum-amber-border/80'
                    }`}
                  >
                    <span>{rel.agreement} of {rel.totalBuilders} agreed</span>
                  </span>
                </td>

                {/* Status */}
                <td className="py-3.5 px-4">
                  <DecisionBadge decision={rel.status} size="sm" />
                </td>

                {/* Action */}
                <td className="py-3.5 px-4 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRelease(rel.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-brand-text hover:text-white bg-brand-panel-elevated/70 backdrop-blur-sm hover:bg-brand-panel border border-brand-border/70 transition-all"
                  >
                    <span>Inspect</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform text-quorum-green" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
