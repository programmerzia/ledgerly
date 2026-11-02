import React from 'react';
import { TwoFactorPanel } from './TwoFactorPanel';
import { SigningPinPanel } from './SigningPinPanel';

export const LiveSecurity: React.FC = () => (
  <div className="flex flex-col gap-5">
    <TwoFactorPanel />
    <SigningPinPanel />
  </div>
);
