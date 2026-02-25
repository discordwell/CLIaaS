// Revalidate cached data every 60 seconds
export const revalidate = 60;

import FeatureGate from '@/components/FeatureGate';
import AICommandCenterContent from './_content';

export default function AIPage() {
  return (
    <FeatureGate feature="ai_dashboard">
      <AICommandCenterContent />
    </FeatureGate>
  );
}
