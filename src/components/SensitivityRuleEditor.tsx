"use client";

interface SensitivityRule {
  piiType: string;
  enabled: boolean;
  autoRedact: boolean;
  maskingStyle: string;
  customPattern?: string;
}

interface SensitivityRuleEditorProps {
  rules: SensitivityRule[];
  onChange: (rules: SensitivityRule[]) => void;
}

const PII_TYPE_LABELS: Record<string, string> = {
  ssn: "Social Security Number",
  credit_card: "Credit Card",
  phone: "Phone Number",
  email: "Email Address",
  address: "Physical Address",
  dob: "Date of Birth",
  medical_id: "Medical ID",
  passport: "Passport Number",
  drivers_license: "Driver's License",
  custom: "Custom Pattern",
};

export default function SensitivityRuleEditor({ rules, onChange }: SensitivityRuleEditorProps) {
  const handleToggle = (piiType: string, field: "enabled" | "autoRedact", value: boolean) => {
    onChange(rules.map((r) => (r.piiType === piiType ? { ...r, [field]: value } : r)));
  };

  const handleStyleChange = (piiType: string, style: string) => {
    onChange(rules.map((r) => (r.piiType === piiType ? { ...r, maskingStyle: style } : r)));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-4 py-3 text-left font-medium">PII Type</th>
            <th className="px-4 py-3 text-center font-medium">Detect</th>
            <th className="px-4 py-3 text-center font-medium">Auto-Redact</th>
            <th className="px-4 py-3 text-left font-medium">Masking</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.piiType} className="border-b border-zinc-800/50">
              <td className="px-4 py-3 text-zinc-300">{PII_TYPE_LABELS[r.piiType] || r.piiType}</td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => handleToggle(r.piiType, "enabled", e.target.checked)}
                  className="accent-zinc-400"
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={r.autoRedact}
                  onChange={(e) => handleToggle(r.piiType, "autoRedact", e.target.checked)}
                  className="accent-red-400"
                  disabled={!r.enabled}
                />
              </td>
              <td className="px-4 py-3">
                <select
                  value={r.maskingStyle}
                  onChange={(e) => handleStyleChange(r.piiType, e.target.value)}
                  disabled={!r.enabled}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1"
                >
                  <option value="full">Full ([REDACTED])</option>
                  <option value="partial">Partial (***1234)</option>
                  <option value="hash">Hash</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
