import { CONNECTOR_REGISTRY, ALL_CONNECTOR_IDS, type ConnectorDef } from './connector-registry';

export type ConnectorDirection = ConnectorDef['direction'];
export type ConnectorStatus = ConnectorDef['status'];

export type ConnectorSpec = {
  id: string;
  name: string;
  direction: ConnectorDirection;
  status: ConnectorStatus;
  formats: string[];
  cliExample: string;
};

export const CONNECTORS: ConnectorSpec[] = ALL_CONNECTOR_IDS.map(id => {
  const def = CONNECTOR_REGISTRY[id];
  return {
    id: def.id,
    name: def.name,
    direction: def.direction,
    status: def.status,
    formats: def.formats,
    cliExample: def.cliExample,
  };
});

export function getConnector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
