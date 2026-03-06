"use client";

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  pl: "Polish",
  tr: "Turkish",
  th: "Thai",
  vi: "Vietnamese",
  cs: "Czech",
  el: "Greek",
  he: "Hebrew",
  id: "Indonesian",
  ms: "Malay",
  ro: "Romanian",
  uk: "Ukrainian",
};

function localeName(code: string): string {
  return LOCALE_NAMES[code] ?? code.toUpperCase();
}

interface LocalePickerProps {
  locales: string[];
  current: string;
  onChange: (locale: string) => void;
}

export default function LocalePicker({
  locales,
  current,
  onChange,
}: LocalePickerProps) {
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="border-2 border-zinc-950 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-zinc-950"
    >
      {locales.map((code) => (
        <option key={code} value={code}>
          {localeName(code)}
        </option>
      ))}
    </select>
  );
}

export { localeName, LOCALE_NAMES };
