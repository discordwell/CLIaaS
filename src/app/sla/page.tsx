import FeatureGate from '@/components/FeatureGate';
import SLAPageContent from './_content';

export default function SLAPage() {
  return (
    <FeatureGate feature="sla_management">
      <SLAPageContent />
    </FeatureGate>
  );
}
