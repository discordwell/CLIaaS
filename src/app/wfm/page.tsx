import FeatureGate from '@/components/FeatureGate';
import WfmPageContent from './_content';

export default function WfmPage() {
  return (
    <FeatureGate feature="workforce_management">
      <WfmPageContent />
    </FeatureGate>
  );
}
