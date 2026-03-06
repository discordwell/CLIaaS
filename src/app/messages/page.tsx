import FeatureGate from '@/components/FeatureGate';
import MessagesPageContent from './_content';

export default function MessagesPage() {
  return (
    <FeatureGate feature="proactive_messaging">
      <MessagesPageContent />
    </FeatureGate>
  );
}
