import FeatureGate from '@/components/FeatureGate';
import CompliancePageContent from './_content';

export default function CompliancePage() {
  return (
    <FeatureGate feature="compliance">
      <CompliancePageContent />
    </FeatureGate>
  );
}
