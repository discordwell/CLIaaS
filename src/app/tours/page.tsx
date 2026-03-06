import FeatureGate from '@/components/FeatureGate';
import ToursPageContent from './_content';

export default function ToursPage() {
  return (
    <FeatureGate feature="proactive_messaging">
      <ToursPageContent />
    </FeatureGate>
  );
}
