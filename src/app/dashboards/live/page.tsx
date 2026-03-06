import FeatureGate from '@/components/FeatureGate';
import LiveDashboardContent from './_content';

export default function LiveDashboardPage() {
  return (
    <FeatureGate feature="live_dashboard">
      <LiveDashboardContent />
    </FeatureGate>
  );
}
