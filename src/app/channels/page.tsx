import FeatureGate from '@/components/FeatureGate';
import ChannelsPageContent from './_content';

export default function ChannelsPage() {
  return (
    <FeatureGate feature="voice_channels">
      <ChannelsPageContent />
    </FeatureGate>
  );
}
