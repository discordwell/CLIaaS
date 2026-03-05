import FeatureGate from '@/components/FeatureGate';
import ForumsContent from './_content';

export default function ForumsPage() {
  return (
    <FeatureGate feature="community_forums">
      <ForumsContent />
    </FeatureGate>
  );
}
