import React, { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export const Spark: React.FC<{ data: number[]; color: string; height?: number; strokeWidth?: number; fillOpacity?: number }> = ({ data, color, height = 36, strokeWidth = 2, fillOpacity = 0.28 }) => {
  const id = useId().replace(/:/g, '');
  const pts = data.map((v, i) => ({ i, v }));
  if (pts.length < 2) return <div style={{ height }} />;
  return (
    <div style={{ height }} className="w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pts} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={strokeWidth} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
