import FeatureGate from '@/components/FeatureGate';
import ReportsPageContent from './_content';

export default function ReportsPage() {
  return (
    <FeatureGate feature="custom_reports">
      <ReportsPageContent />
    </FeatureGate>
  );
}
