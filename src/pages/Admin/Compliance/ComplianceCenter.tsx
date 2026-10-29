/**
 * Compliance & Governance Center per docs/10_SaaS_Admin.md §3.12.
 * GDPR Data Subject Requests (DSAR) with 30-day SLA countdowns,
 * data residency tracking (US, EU, AF), and Data Processing Agreements (DPA).
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { GdprRequest } from '@/types/admin';
import { StatusPill } from '@/components/domain/StatusPill';
import { toast } from 'sonner';
import {
  Scale,
  ShieldCheck,
  Download,
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Globe,
  Plus,
} from 'lucide-react';

export const ComplianceCenter: React.FC = () => {
  const { gdprRequests, completeGdprRequest, tenants } = useAdminStore();

  const [activeTab, setActiveTab] = useState<'gdpr' | 'residency' | 'dpa_tracker'>('gdpr');

  const handleCompleteRequest = (requestId: string) => {
    try {
      completeGdprRequest(requestId, `/exports/gdpr/dsar_export_${Date.now()}.zip`);
      toast.success('GDPR data package generated, encrypted, and dispatched to data subject.');
    } catch {
      toast.error('Failed to complete GDPR request');
    }
  };

  // Compute residency counts
  const residencyCounts = {
    'AF-South': tenants.filter((t) => t.dataResidency === 'af-south').length,
    'EU-Central': tenants.filter((t) => t.dataResidency === 'eu-central').length,
    'US-East': tenants.filter((t) => t.dataResidency === 'us-east').length,
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Compliance & Data Governance</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              GDPR & SOC-2 Ready
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Subject Access Requests (DSAR), legal data residency routing, and Data Processing Agreements (DPA).
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border text-xs overflow-x-auto no-scrollbar flex-nowrap">
        <button
          type="button"
          onClick={() => setActiveTab('gdpr')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'gdpr'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>GDPR / DSAR Requests ({gdprRequests.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('residency')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'residency'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Data Residency Vaults</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('dpa_tracker')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'dpa_tracker'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>DPA & Security Questionnaire</span>
        </button>
      </div>

      {/* Tab: GDPR Requests */}
      {activeTab === 'gdpr' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Subject Access & Erasure Queue (Statutory 30-Day SLA)
            </h3>
            <span className="text-[10px] font-mono text-text-muted">GDPR Art. 17 / Art. 20</span>
          </div>

          <div className="rounded bg-surface border border-border divide-y divide-border/60 text-xs">
            {gdprRequests.map((req: GdprRequest) => {
              const isPending = req.status === 'pending' || req.status === 'processing';
              return (
                <div key={req.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-surface-neutral text-[10px]">
                        GDPR {req.kind}
                      </span>
                      <span className="font-bold text-text-primary">Target Tenant: {req.tenantId}</span>
                      <StatusPill status={req.status as any} />
                    </div>
                    <div className="text-[11px] text-text-secondary">
                      Data Subject: <span className="font-mono text-text-primary">{req.requestedByEmail}</span> • Requested by: {req.requestedBy}
                    </div>
                    <div className="text-[10px] font-mono text-text-muted">
                      Statutory SLA Deadline: {new Date(req.dueAt).toLocaleDateString()}
                      {req.completedAt && ` • Completed on: ${new Date(req.completedAt).toLocaleString()}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isPending ? (
                      <button
                        type="button"
                        onClick={() => handleCompleteRequest(req.id)}
                        className="h-8 px-3 rounded bg-violet text-white hover:opacity-90 font-medium text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Generate & Export Archive</span>
                      </button>
                    ) : (
                      <span className="text-[11px] font-mono text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Delivered
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Data Residency */}
      {activeTab === 'residency' && (
        <div className="space-y-4 text-xs">
          <div>
            <h3 className="font-bold text-sm text-text-primary">Sovereign Data Residency Vaults</h3>
            <p className="text-text-muted mt-0.5">Strict geographic database partitioning based on customer domicile</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-text-primary">AF-South (Cape Town)</span>
                <span className="font-mono text-violet font-bold">{residencyCounts['AF-South']} Tenants</span>
              </div>
              <p className="text-text-muted text-[11px]">
                Somalia, Kenya, and East African regional tenants. Conforms to local Central Bank financial data protection guidelines.
              </p>
              <div className="pt-2 border-t border-border/40 text-[10px] font-mono text-success">
                AES-256 Multi-tenant RLS Active
              </div>
            </div>

            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-text-primary">EU-Central (Frankfurt)</span>
                <span className="font-mono text-violet font-bold">{residencyCounts['EU-Central']} Tenants</span>
              </div>
              <p className="text-text-muted text-[11px]">
                European Union tenants. Strict GDPR compliance with German Federal Data Protection Act (BDSG) controls.
              </p>
              <div className="pt-2 border-t border-border/40 text-[10px] font-mono text-success">
                BSI C5 & ISO 27001 Audited
              </div>
            </div>

            <div className="p-3.5 rounded bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-text-primary">US-East (N. Virginia)</span>
                <span className="font-mono text-violet font-bold">{residencyCounts['US-East']} Tenants</span>
              </div>
              <p className="text-text-muted text-[11px]">
                US & international trading corporations. SOC-2 Type II controls with automated daily DR WAL replication.
              </p>
              <div className="pt-2 border-t border-border/40 text-[10px] font-mono text-success">
                SOC-2 Type II Certified
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: DPA Tracker */}
      {activeTab === 'dpa_tracker' && (
        <div className="p-4 rounded bg-surface border border-border space-y-3 text-xs">
          <h3 className="font-bold text-sm text-text-primary">Data Processing Agreements (DPA) Execution Status</h3>
          <p className="text-text-muted">Standard Contractual Clauses (SCCs) signed with regulated accounting customers.</p>
          <div className="divide-y divide-border/60">
            <div className="py-2.5 flex items-center justify-between">
              <div>
                <div className="font-semibold text-text-primary">Standard EU Data Processing Addendum (DPA v2.4)</div>
                <div className="text-[10px] text-text-muted">Includes EU Standard Contractual Clauses (Controller-to-Processor)</div>
              </div>
              <span className="px-2 py-0.5 rounded bg-success-soft text-success font-mono font-semibold">
                100% Signed
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <div>
                <div className="font-semibold text-text-primary">Vendor Security Questionnaire (CAIQ-Lite)</div>
                <div className="text-[10px] text-text-muted">Pre-answered questionnaire available for enterprise procurement reviews</div>
              </div>
              <button
                type="button"
                onClick={() => toast.success('Downloaded SOC-2 Type II CAIQ-Lite Security Package')}
                className="px-2 py-1 rounded border border-border hover:bg-surface-neutral font-medium cursor-pointer"
              >
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
