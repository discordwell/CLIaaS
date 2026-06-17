import FeatureGate from '@/components/FeatureGate';
import TourDetailContent from './_content';

export default async function TourDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FeatureGate feature="proactive_messaging">
      <TourDetailContent tourId={id} />
    </FeatureGate>
  );
}
