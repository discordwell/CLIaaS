// Revalidate cached data every 60 seconds
export const revalidate = 60;

import FeatureGate from '@/components/FeatureGate';
import SandboxPageContent from './_content';

export default function SandboxPage() {
  return (
    <FeatureGate feature="sandbox">
      <SandboxPageContent />
    </FeatureGate>
  );
}
