import FeatureGate from '@/components/FeatureGate';
import AnalyticsPageContent from './_content';

export default function AnalyticsPage() {
  return (
    <FeatureGate feature="analytics">
      <AnalyticsPageContent />
    </FeatureGate>
  );
}
