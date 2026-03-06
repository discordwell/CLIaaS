import FeatureGate from '@/components/FeatureGate';
import DashboardsContent from './_content';

export default function DashboardsPage() {
  return (
    <FeatureGate feature="custom_reports">
      <DashboardsContent />
    </FeatureGate>
  );
}
