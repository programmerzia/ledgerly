import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { IS_LIVE } from '@/api/config';
import { isLiveRoute } from '@/data/liveRoutes';

/** In live mode, a screen not yet connected to the API says so rather than showing mock figures. */
export const LiveRouteGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const { co } = useParams();
  if (!IS_LIVE || isLiveRoute(pathname)) {
    return <>{children}</>;
  }
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <h1 className="text-sm font-semibold text-text-primary">This screen isn't connected to your books yet</h1>
      <p className="mt-1 text-[13px] text-text-muted">It's being moved over from the demo, so it shows nothing here for now.</p>
      <Link to={`/${co}/accounts`} className="mt-3 inline-block text-[13px] text-accent hover:underline">Open the chart of accounts</Link>
    </div>
  );
};
