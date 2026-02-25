// Revalidate cached data every 60 seconds
export const revalidate = 60;

import FeatureGate from '@/components/FeatureGate';
import SLAPageContent from './_content';

export default function SLAPage() {
  return (
    <FeatureGate feature="sla_management">
      <SLAPageContent />
    </FeatureGate>
  );
}
