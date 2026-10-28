/**
 * Platform Operations & Telemetry per docs/10_SaaS_Admin.md §3.9.
 * Laravel Horizon queues, p95 latency by endpoint, per-tenant database footprint,
 * maintenance mode toggle, and database restore drill status.
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { toast } from 'sonner';
import {
  Activity,
  Server,
  Database,
  ShieldAlert,
  Zap,
  CheckCircle2,
  Clock,
  ExternalLink,
  RotateCcw,
  AlertTriangle,
  HardDrive,
} from 'lucide-react';

export const PlatformOps: React.FC = () => {
  const { queueMetrics, tenants } = useAdminStore();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    'Scheduled database optimization window in progress. Service resumes at 03:00 UTC.'
  );

  // Top 5 largest tenants by storage/database size
  const largestTenants = [...tenants]
    .sort((a, b) => b.usage.storageMbUsed - a.usage.storageMbUsed)
    .slice(0, 5);

  const routeLatencies = [
    { route: 'POST /api/v1/invoices', p50: '42ms', p95: '118ms', throughput: '240 req/min', status: 'Healthy' },
    { route: 'POST /api/v1/journals/post', p50: '68ms', p95: '184ms', throughput: '180 req/min', status: 'Healthy' },
    { route: 'GET /api/v1/reports/trial-balance', p50: '54ms', p95: '142ms', throughput: '95 req/min', status: 'Healthy' },
    { route: 'POST /api/v1/bank-feeds/sync', p50: '110ms', p95: '290ms', throughput: '45 req/min', status: 'Healthy' },
  ];

  const handleToggleMaintenance = () => {
    const next = !maintenanceMode;
    setMaintenanceMode(next);
    if (next) {
      toast.warning('Maintenance mode enabled. Tenant traffic redirected to maintenance page.');
    } else {
      toast.success('Maintenance mode disabled. Normal traffic restored.');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Platform Telemetry & Infrastructure Ops</h1>
            <span className="px-2 py-0.5 rounded-full bg-success-soft text-success text-[10px] font-mono font-semibold">
              99.98% SLA Normal
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Laravel Horizon worker supervisors, endpoint latency p95, per-tenant database sizing, and maintenance mode.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMaintenance}
            className={`h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
              maintenanceMode ? 'bg-danger text-white' : 'bg-surface border border-border text-text-primary hover:border-border-strong'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{maintenanceMode ? 'Disable Maintenance Mode' : 'Enable Maintenance Mode'}</span>
          </button>
        </div>
      </div>

      {/* Maintenance Mode Warning if Active */}
      {maintenanceMode && (
        <div className="p-3 rounded bg-danger-soft border border-danger/30 text-danger text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>MAINTENANCE MODE ENGAGED:</strong> {maintenanceMessage}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase font-bold">503 Intercept Active</span>
        </div>
      )}

      {/* Horizon Worker Supervisors */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {queueMetrics.map((q) => (
          <div key={q.name} className="p-3.5 rounded bg-surface border border-border space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-violet" />
                <span className="font-mono font-bold text-xs capitalize">{q.name} Queue</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-success-soft text-success font-semibold">
                Supervisors OK
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/40 text-xs">
              <div>
                <span className="text-[10px] text-text-muted">Throughput</span>
                <div className="font-mono font-bold text-text-primary mt-0.5">{q.throughputPerMinute} /m</div>
              </div>
              <div>
                <span className="text-[10px] text-text-muted">Wait Time</span>
                <div className="font-mono font-semibold text-text-secondary mt-0.5">{(q.averageWaitTimeMs / 1000).toFixed(1)}s</div>
              </div>
              <div>
                <span className="text-[10px] text-text-muted">Current Jobs</span>
                <div className="font-mono font-semibold text-text-secondary mt-0.5">{q.currentJobs} queued</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Endpoint Latencies & DB Footprint Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Latency by Endpoint */}
        <div className="rounded bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Route Latency Telemetry (p95 Sentry Mirrored)
            </h3>
            <span className="text-[10px] font-mono text-text-muted">Sample window: 1h</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="h-7 text-text-muted text-[10px] uppercase font-semibold border-b border-border">
                  <th className="py-1">Endpoint Route</th>
                  <th className="py-1">p50</th>
                  <th className="py-1">p95</th>
                  <th className="py-1">Throughput</th>
                  <th className="py-1 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono text-xs">
                {routeLatencies.map((r) => (
                  <tr key={r.route} className="h-8">
                    <td className="py-1 text-text-primary font-sans font-medium">{r.route}</td>
                    <td className="py-1 text-text-muted">{r.p50}</td>
                    <td className="py-1 text-text-primary font-bold">{r.p95}</td>
                    <td className="py-1 text-text-secondary">{r.throughput}</td>
                    <td className="py-1 text-right text-success font-sans font-semibold text-[11px]">
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Database Sizing per Tenant */}
        <div className="rounded bg-surface border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Database Footprint (Largest Tenants)
            </h3>
            <span className="text-[10px] font-mono text-text-muted">Total DB: 42.8 GB</span>
          </div>

          <div className="space-y-2 text-xs">
            {largestTenants.map((t) => {
              const gb = (t.usage.storageMbUsed / 1024).toFixed(1);
              const maxGb = 50;
              const pct = Math.min(100, Math.round((parseFloat(gb) / maxGb) * 100));

              return (
                <div key={t.id} className="p-2.5 rounded bg-surface-neutral/40 border border-border/60 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary">{t.name}</span>
                    <span className="font-mono text-text-secondary">
                      {gb} GB / {maxGb} GB ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-neutral rounded-full overflow-hidden">
                    <div
                      className={`h-full ${pct > 80 ? 'bg-danger' : 'bg-violet'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Disaster Recovery & Drill Status */}
      <div className="p-4 rounded bg-surface border border-border flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <div>
            <div className="font-bold text-text-primary">Automated Database Backups & PITR Drills</div>
            <div className="text-text-muted text-[11px]">
              Point-in-time recovery WAL logs archiving to AWS S3 / Cloudflare R2 every 5 minutes.
              Last restore drill: Passed Oct 24, 2026 (RTO: 4m 12s, RPO: 0s).
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => toast.success('Disaster recovery verification audit logged to compliance trail.')}
          className="h-8 px-3 rounded border border-border hover:bg-surface-neutral font-medium cursor-pointer"
        >
          Verify WAL Checksum
        </button>
      </div>
    </div>
  );
};
