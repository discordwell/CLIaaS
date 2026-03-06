import FeatureGate from '@/components/FeatureGate';
import DashboardDetailContent from './_content';

export default function DashboardDetailPage({ params }: { params: { id: string } }) {
  return (
    <FeatureGate feature="custom_reports">
      <DashboardDetailContent id={params.id} />
    </FeatureGate>
  );
}
