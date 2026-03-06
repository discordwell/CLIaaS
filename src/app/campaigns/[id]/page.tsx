import FeatureGate from '@/components/FeatureGate';
import CampaignDetailContent from './_content';

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  return (
    <FeatureGate feature="proactive_messaging">
      <CampaignDetailContent campaignId={params.id} />
    </FeatureGate>
  );
}
