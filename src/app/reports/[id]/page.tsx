import FeatureGate from '@/components/FeatureGate';
import ReportDetailContent from './_content';

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FeatureGate feature="custom_reports">
      <ReportDetailContent id={id} />
    </FeatureGate>
  );
}
