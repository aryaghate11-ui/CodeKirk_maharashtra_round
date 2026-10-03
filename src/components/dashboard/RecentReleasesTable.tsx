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
            <th className="py-3 px-4 font-semibold">Package & Repo</th>
            <th className="py-3 px-4 font-semibold">Version</th>
            <th className="py-3 px-4 font-semibold">Pinned Commit</th>
            <th className="py-3 px-4 font-semibold text-center">Builders</th>
            <th className="py-3 px-4 font-semibold text-center">Agreement</th>
            <th className="py-3 px-4 font-semibold">Policy</th>
            <th className="py-3 px-4 font-semibold">Status</th>
            <th className="py-3 px-4 font-semibold">Verified</th>
            <th className="py-3 px-4 font-semibold text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border/40">
          {releases.map((rel) => {
            return (
              <tr
                key={rel.id}
                onClick={() => onSelectRelease(rel.id)}
                className="hover:bg-brand-panel-elevated/40 cursor-pointer transition-colors duration-150 group"
              >
                {/* Package */}
                <td className="py-3.5 px-4 min-w-[190px]">
                  <div className="font-semibold text-white group-hover:text-quorum-green-light transition-colors">
                    {rel.name}
                  </div>
                  <div className="text-[11px] text-brand-muted font-mono truncate max-w-[210px] flex items-center gap-1">
                    {rel.repo}
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </div>
                </td>

                {/* Version */}
                <td className="py-3.5 px-4 font-mono font-medium text-brand-text">
                  <span className="px-2 py-0.5 rounded bg-brand-bg-deep border border-brand-border text-[11px]">
                    {rel.version}
                  </span>
                </td>

                {/* Commit */}
                <td className="py-3.5 px-4 font-mono text-[11px] text-brand-muted">
                  <div className="flex items-center gap-1">
                    <span>{truncateHash(rel.commit, 7, 0)}</span>
                    <CopyButton text={rel.commit} title="Copy commit hash" />
                  </div>
                </td>

                {/* Builders */}
                <td className="py-3.5 px-4 text-center font-mono text-xs text-brand-text">
                  {rel.totalBuilders} Nodes
                </td>

                {/* Agreement */}
                <td className="py-3.5 px-4 text-center">
                  <span
                    className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${
                      rel.agreement >= rel.policy.k
                        ? 'bg-quorum-green-bg text-quorum-green-light border border-quorum-green-border'
                        : 'bg-quorum-red-bg text-quorum-red-light border border-quorum-red-border'
                    }`}
                  >
                    {rel.agreement} / {rel.totalBuilders}
                  </span>
                </td>

                {/* Policy */}
                <td className="py-3.5 px-4 font-mono text-xs text-brand-muted">
                  {rel.policy.k}-of-{rel.policy.n}
                </td>

                {/* Status */}
                <td className="py-3.5 px-4">
                  <DecisionBadge decision={rel.status} size="sm" />
                </td>

                {/* Time */}
                <td className="py-3.5 px-4 text-[11px] text-brand-subtle whitespace-nowrap">
                  {formatRelativeTime(rel.createdAt)}
                </td>

                {/* Action */}
                <td className="py-3.5 px-4 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRelease(rel.id);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-brand-muted hover:text-white hover:bg-brand-panel-elevated border border-brand-border transition-all"
                  >
                    <span>Inspect</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
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
