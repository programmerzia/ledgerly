import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Spark } from './Spark';

export const KpiTile: React.FC<{
  label: string;
  icon: React.ReactNode;
  tint: string; // e.g. 'bg-success-soft text-success'
  color: string; // css var for sparkline
  value: string;
  valueClass?: string;
  sub: React.ReactNode;
  series: number[];
  to: string;
  index: number;
}> = ({ label, icon, tint, color, value, valueClass = 'text-text-primary', sub, series, to, index }) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      style={{ animationDelay: `${index * 40}ms` }}
      className="dash-card text-left bg-surface border border-border rounded-xl shadow-sm hover:shadow-md hover:border-border-strong transition-[box-shadow,border-color] duration-200 cursor-pointer flex flex-col gap-2 pt-4 overflow-hidden min-w-0"
    >
      <div className="px-4 flex items-center gap-2.5">
        <span className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>{icon}</span>
        <span className="text-[13px] font-medium text-text-secondary truncate">{label}</span>
      </div>
      <div className={`px-4 text-2xl font-semibold tracking-tight tabular-nums truncate ${valueClass}`}>{value}</div>
      <div className="px-4 text-xs text-text-muted min-h-4 leading-snug">{sub}</div>
      <div className="mt-auto pt-1"><Spark data={series} color={color} height={40} /></div>
    </button>
  );
};
