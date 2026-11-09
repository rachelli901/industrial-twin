import type { ConnectionStatus, TelemetryMessage } from './telemetryClient';

/** Contract shared by the WebSocket gateway client and the in-browser demo client. */
export interface GatewayClient {
  onAuthRequired: () => void;
  onAuthFailure: () => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onMessage: (msg: TelemetryMessage) => void;
  authenticate(token: string): void;
  send(data: object): boolean;
  destroy(): void;
}
