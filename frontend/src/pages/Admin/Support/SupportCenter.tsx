/**
 * Support & Communications Center per docs/10_SaaS_Admin.md §3.8.
 * Global tenant/user search, operator impersonation session logs,
 * failed jobs queue with one-click retry, and broadcast announcements manager.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAdminStore } from '@/mock/store/adminStore';
import { Announcement, PlanCode } from '@/types/admin';
import { toast } from 'sonner';
import {
  Headphones,
  Search,
  RotateCcw,
  Megaphone,
  Plus,
  UserCheck,
  AlertOctagon,
  Clock,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  Bell,
} from 'lucide-react';

export const SupportCenter: React.FC = () => {
  const navigate = useNavigate();
  const {
    tenants,
    failedJobs,
    announcements,
    retryFailedJob,
    createAnnouncement,
    activeImpersonation,
    auditEvents,
  } = useAdminStore();

  const [activeTab, setActiveTab] = useState<'search' | 'failed_jobs' | 'announcements' | 'impersonation_logs'>('failed_jobs');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);

  // New announcement form
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'info' | 'maintenance' | 'feature' | 'security'>('info');
  const [targetPlan, setTargetPlan] = useState<'all' | 'starter' | 'professional' | 'business' | 'enterprise'>('all');

  // Search Results across tenants and users
  const searchResults = searchQuery.trim()
    ? tenants.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.ownerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.subscription.stripeCustomerId.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // Filter impersonation events from audit log
  const impersonationEvents = auditEvents.filter(
    (a) => a.action === 'impersonate_start' || a.action === 'impersonate_end'
  );

  const handleRetryJob = (jobId: string) => {
    try {
      retryFailedJob(jobId);
      toast.success(`Job ${jobId} pushed to Horizon retry queue.`);
    } catch {
      toast.error('Failed to retry job');
    }
  };

  const handleCreateAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    try {
      createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        kind,
        audience: {
          allTenants: targetPlan === 'all',
          plans: targetPlan === 'all' ? undefined : [targetPlan as PlanCode],
        },
        isActive: true,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });

      toast.success('Broadcast announcement scheduled and published to tenant apps!');
      setShowAnnouncementModal(false);
      setTitle('');
      setBody('');
    } catch {
      toast.error('Failed to create announcement');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Support & Communications Operations</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              Live Back-Office
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Cross-tenant diagnostics, Horizon background job retries, impersonation logging, and system announcements.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAnnouncementModal(true)}
          className="h-8 px-3 rounded-sm bg-violet text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
        >
          <Megaphone className="w-3.5 h-3.5" />
          <span>Post Broadcast Announcement</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border text-xs overflow-x-auto no-scrollbar flex-nowrap shrink-0 whitespace-nowrap">
        <button
          type="button"
          onClick={() => setActiveTab('failed_jobs')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer ${
            activeTab === 'failed_jobs'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Failed Background Jobs</span>
          <span className="px-1.5 py-0.2 rounded-full bg-danger-soft text-danger font-mono text-[10px] font-bold">
            {failedJobs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('announcements')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer ${
            activeTab === 'announcements'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Announcements & Maintenance Banners ({announcements.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('impersonation_logs')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer ${
            activeTab === 'impersonation_logs'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Staff Impersonation Audit Logs</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('search')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer ${
            activeTab === 'search'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Global Search (Tenants & Stripe IDs)</span>
        </button>
      </div>

      {/* Tab: Failed Jobs */}
      {activeTab === 'failed_jobs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Laravel Horizon Failed Job Queue ({failedJobs.length} items)
            </h3>
            <span className="text-[10px] font-mono text-text-muted">Auto-retry exponential backoff: 3 attempts</span>
          </div>

          <div className="rounded bg-surface border border-border divide-y divide-border/60 text-xs">
            {failedJobs.map((job) => (
              <div key={job.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-danger bg-danger-soft px-1.5 py-0.2 rounded text-[10px]">
                      {job.jobClass}
                    </span>
                    <span className="font-mono text-text-secondary">Tenant: {job.tenantId}</span>
                    <span className="text-[10px] text-text-muted font-mono">{new Date(job.failedAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="font-mono text-[11px] text-text-secondary bg-surface-neutral/60 p-2 rounded border border-border/60 max-w-2xl break-all">
                    {job.exception}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRetryJob(job.id)}
                    className="h-8 px-3 rounded bg-violet text-white hover:opacity-90 font-medium text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Job</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Announcements */}
      {activeTab === 'announcements' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Active Broadcast Announcements
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {announcements.map((ann) => (
              <div key={ann.id} className="p-3.5 rounded bg-surface border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Megaphone className="w-3.5 h-3.5 text-violet" />
                    <span className="font-bold text-text-primary">{ann.title}</span>
                  </div>
                  <span className="font-mono text-[10px] uppercase px-1.5 py-0.2 rounded bg-violet-soft text-violet font-semibold">
                    {ann.kind}
                  </span>
                </div>
                <p className="text-text-secondary text-[11px]">{ann.body}</p>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono text-text-muted">
                  <span>Target: {ann.audience.allTenants ? 'All Tenants' : (ann.audience.plans?.join(', ') || 'Custom')}</span>
                  <span>Until: {new Date(ann.endsAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Impersonation Logs */}
      {activeTab === 'impersonation_logs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Operator Impersonation Audit Logs (SOC-2 CC6.1 Enforced)
            </h3>
            <span className="text-[10px] font-mono text-success flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-success" />
              Cryptographically Chained
            </span>
          </div>

          <div className="rounded bg-surface border border-border overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
                  <th className="px-3">Timestamp</th>
                  <th className="px-3">Staff Operator</th>
                  <th className="px-3">Target Tenant ID</th>
                  <th className="px-3">Action</th>
                  <th className="px-3">Reason</th>
                  <th className="px-3 text-right">SHA-256 Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {impersonationEvents.map((ev) => (
                  <tr key={ev.id} className="h-9 hover:bg-surface-neutral/50">
                    <td className="px-3 font-mono text-text-muted">{new Date(ev.occurredAt).toLocaleString()}</td>
                    <td className="px-3 font-semibold text-text-primary">{ev.adminName}</td>
                    <td className="px-3 font-mono text-violet">{ev.tenantId}</td>
                    <td className="px-3">
                      <span className="px-1.5 py-0.2 rounded bg-violet-soft text-violet font-mono text-[10px] font-bold uppercase">
                        {ev.action}
                      </span>
                    </td>
                    <td className="px-3 text-text-secondary">{ev.reason}</td>
                    <td className="px-3 text-right font-mono text-[10px] text-text-muted">
                      #{ev.hash.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Global Search */}
      {activeTab === 'search' && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all tenants, customer emails, domains, or Stripe IDs..."
              className="w-full h-9 pl-8 pr-3 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="rounded bg-surface border border-border divide-y divide-border/60 text-xs">
            {searchResults.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-xs">
                {searchQuery.trim() ? 'No matching records found.' : 'Enter a search term above to query all records.'}
              </div>
            ) : (
              searchResults.map((t) => (
                <div
                  key={t.id}
                  onClick={() => navigate(`/admin/tenants/${t.id}`)}
                  className="p-3 flex items-center justify-between hover:bg-surface-neutral/50 cursor-pointer transition"
                >
                  <div>
                    <div className="font-bold text-text-primary">{t.name}</div>
                    <div className="text-[11px] text-text-muted font-mono">{t.slug}.ledgerly.io • {t.ownerEmail}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-violet">{t.subscription.stripeCustomerId}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleCreateAnnouncement}
            className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-bold text-text-primary">Publish System Announcement</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Headline</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Scheduled Infrastructure Maintenance Window"
                  className="w-full h-8 px-2.5 bg-surface border border-border rounded text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Announcement Body</label>
                <textarea
                  required
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Explain message or maintenance schedule to tenant users..."
                  className="w-full p-2 bg-surface border border-border rounded text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Announcement Kind</label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full h-8 px-2 bg-surface border border-border rounded text-xs"
                  >
                    <option value="banner">Top Banner</option>
                    <option value="in_app">In-App Notification</option>
                    <option value="maintenance">Maintenance Notice</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Audience</label>
                  <select
                    value={targetPlan}
                    onChange={(e) => setTargetPlan(e.target.value as any)}
                    className="w-full h-8 px-2 bg-surface border border-border rounded text-xs"
                  >
                    <option value="all">All Plans</option>
                    <option value="starter">Starter Only</option>
                    <option value="professional">Professional Only</option>
                    <option value="business">Business Only</option>
                    <option value="enterprise">Enterprise Only</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAnnouncementModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded bg-violet text-white hover:opacity-90 text-xs font-semibold cursor-pointer shadow-xs"
              >
                Schedule & Broadcast
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
