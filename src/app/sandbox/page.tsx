import FeatureGate from '@/components/FeatureGate';
import SandboxPageContent from './_content';

export default function SandboxPage() {
  return (
    <FeatureGate feature="sandbox">
      <SandboxPageContent />
    </FeatureGate>
  );
}
