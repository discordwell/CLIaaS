import FeatureGate from '@/components/FeatureGate';
import CampaignsPageContent from './_content';

export default function CampaignsPage() {
  return (
    <FeatureGate feature="proactive_messaging">
      <CampaignsPageContent />
    </FeatureGate>
  );
}
