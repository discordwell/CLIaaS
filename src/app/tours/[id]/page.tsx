import FeatureGate from '@/components/FeatureGate';
import TourDetailContent from './_content';

export default function TourDetailPage({ params }: { params: { id: string } }) {
  return (
    <FeatureGate feature="proactive_messaging">
      <TourDetailContent tourId={params.id} />
    </FeatureGate>
  );
}
