import React from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

/** A bare trend line: no fill, no dots. `fillOpacity` is accepted for older callers and ignored. */
export const Spark: React.FC<{ data: number[]; color: string; height?: number; strokeWidth?: number; fillOpacity?: number }> = ({ data, color, height = 36, strokeWidth = 1.5 }) => {
  const pts = data.map((v, i) => ({ i, v }));
  if (pts.length < 2) return <div style={{ height }} />;
  return (
    <div style={{ height }} className="w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
          <Line type="linear" dataKey="v" stroke={color} strokeWidth={strokeWidth} isAnimationActive={false} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
