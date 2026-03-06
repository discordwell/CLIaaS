import FeatureGate from '@/components/FeatureGate';
import ReportDetailContent from './_content';

export default function ReportDetailPage({ params }: { params: { id: string } }) {
  return (
    <FeatureGate feature="custom_reports">
      <ReportDetailContent id={params.id} />
    </FeatureGate>
  );
}
