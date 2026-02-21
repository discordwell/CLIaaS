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
    id: "notion",
    name: "Notion",
    direction: "bidirectional",
    status: "ready",
    formats: ["json", "csv", "markdown"],
    cliExample: "cliaas import --from notion --out ./exports/notion.json",
  },
  {
    id: "trello",
    name: "Trello",
    direction: "import",
    status: "building",
    formats: ["json", "csv"],
    cliExample: "cliaas import --from trello --out ./exports/trello.json",
  },
  {
    id: "airtable",
    name: "Airtable",
    direction: "export",
    status: "planned",
    formats: ["json", "csv"],
    cliExample: "cliaas export --to airtable --input ./exports/cliaas.json",
  },
];

export function getConnector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
