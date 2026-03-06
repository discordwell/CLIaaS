import FeatureGate from '@/components/FeatureGate';
import RoutingAnalyticsContent from './_content';

export default function RoutingAnalyticsPage() {
  return (
    <FeatureGate feature="analytics">
      <RoutingAnalyticsContent />
    </FeatureGate>
  );
}
