import FeatureGate from '@/components/FeatureGate';
import CampaignAnalyticsContent from './_content';

export default async function CampaignAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FeatureGate feature="proactive_messaging">
      <CampaignAnalyticsContent campaignId={id} />
    </FeatureGate>
  );
}
