import FeatureGate from '@/components/FeatureGate';
import BusinessHoursContent from './_content';

export default function BusinessHoursPage() {
  return (
    <FeatureGate feature="sla_management">
      <BusinessHoursContent />
    </FeatureGate>
  );
}
