import FeatureGate from '@/components/FeatureGate';
import AICommandCenterContent from './_content';

export default function AIPage() {
  return (
    <FeatureGate feature="ai_dashboard">
      <AICommandCenterContent />
    </FeatureGate>
  );
}
