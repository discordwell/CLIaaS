import FeatureGate from '@/components/FeatureGate';
import QAContent from './_content';

export default function QAPage() {
  return (
    <FeatureGate feature="qa_reviews">
      <QAContent />
    </FeatureGate>
  );
}
