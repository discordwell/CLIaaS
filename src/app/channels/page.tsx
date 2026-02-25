// Revalidate cached data every 60 seconds
export const revalidate = 60;

import FeatureGate from '@/components/FeatureGate';
import ChannelsPageContent from './_content';

export default function ChannelsPage() {
  return (
    <FeatureGate feature="voice_channels">
      <ChannelsPageContent />
    </FeatureGate>
  );
}
