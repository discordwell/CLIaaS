import FeatureGate from '@/components/FeatureGate';
import CampaignDetailContent from './_content';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FeatureGate feature="proactive_messaging">
      <CampaignDetailContent campaignId={id} />
    </FeatureGate>
  );
}
