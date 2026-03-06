import FeatureGate from '@/components/FeatureGate';
import RoutingSettingsContent from './_content';

export default function RoutingSettingsPage() {
  return (
    <FeatureGate feature="advanced_automation">
      <RoutingSettingsContent />
    </FeatureGate>
  );
}
