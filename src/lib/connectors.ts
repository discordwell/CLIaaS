export type ConnectorDirection = "import" | "export" | "bidirectional";
export type ConnectorStatus = "planned" | "building" | "ready";

export type ConnectorSpec = {
  id: string;
  name: string;
  direction: ConnectorDirection;
  status: ConnectorStatus;
  formats: string[];
  cliExample: string;
};

export const CONNECTORS: ConnectorSpec[] = [
  {
    id: "zendesk",
    name: "Zendesk",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas zendesk export --subdomain acme --email agent@acme.com --token <key> --out ./exports/zendesk",
  },
  {
    id: "kayako",
    name: "Kayako",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas kayako export --domain support.acme.com --email agent@acme.com --password <pw> --out ./exports/kayako",
  },
];

export function getConnector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
