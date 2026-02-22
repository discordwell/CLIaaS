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
    id: "helpcrunch",
    name: "HelpCrunch",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas helpcrunch export --api-key <key> --out ./exports/helpcrunch",
  },
  {
    id: "freshdesk",
    name: "Freshdesk",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas freshdesk export --subdomain acme --api-key <key> --out ./exports/freshdesk",
  },
  {
    id: "groove",
    name: "Groove",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas groove export --api-token <token> --out ./exports/groove",
  },
];

export function getConnector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
