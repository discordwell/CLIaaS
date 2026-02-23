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
  {
    id: "intercom",
    name: "Intercom",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas intercom export --access-token <token> --out ./exports/intercom",
  },
  {
    id: "helpscout",
    name: "Help Scout",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas helpscout export --app-id <id> --app-secret <secret> --out ./exports/helpscout",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas hubspot export --access-token <token> --out ./exports/hubspot",
  },
  {
    id: "zoho-desk",
    name: "Zoho Desk",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas zoho-desk export --org-id <id> --access-token <token> --out ./exports/zoho-desk",
  },
  {
    id: "kayako",
    name: "Kayako",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas kayako export --domain acme.kayako.com --email admin@acme.com --password <pass> --out ./exports/kayako",
  },
  {
    id: "kayako-classic",
    name: "Kayako Classic",
    direction: "bidirectional",
    status: "ready",
    formats: ["jsonl", "json"],
    cliExample:
      "cliaas kayako-classic export --domain acme.kayako.com --api-key <key> --secret-key <secret> --out ./exports/kayako-classic",
  },
];

export function getConnector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
