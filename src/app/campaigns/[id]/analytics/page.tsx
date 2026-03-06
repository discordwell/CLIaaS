import FeatureGate from '@/components/FeatureGate';
import CampaignAnalyticsContent from './_content';

export default function CampaignAnalyticsPage({ params }: { params: { id: string } }) {
  return (
    <FeatureGate feature="proactive_messaging">
      <CampaignAnalyticsContent campaignId={params.id} />
    </FeatureGate>
  );
}
