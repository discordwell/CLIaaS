import FeatureGate from '@/components/FeatureGate';
import DashboardDetailContent from './_content';

export default async function DashboardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FeatureGate feature="custom_reports">
      <DashboardDetailContent id={id} />
    </FeatureGate>
  );
}
