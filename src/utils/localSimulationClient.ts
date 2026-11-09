import { SimulationEngine } from '../../server/SimulationEngine.ts';
import { parseCommand } from '../domain/operations.ts';
import type { GatewayClient } from './gatewayClient';
import type { ConnectionStatus, TelemetryMessage } from './telemetryClient';

/**
 * Runs the very same simulation engine in the browser for static demo builds.
 * Emits the same protocol messages as the WebSocket gateway so the store,
 * charts and 3D scene stay unchanged.
 */
export class LocalSimulationClient implements GatewayClient {
  onAuthRequired = () => {};
  onAuthFailure = () => {};
  onStatusChange: (status: ConnectionStatus) => void = () => {};
  onMessage: (msg: TelemetryMessage) => void = () => {};

  private engine = new SimulationEngine();
  private timer = 0;
  private last = performance.now();

  constructor() {
    // The view assigns its handlers right after construction, so defer the
    // first frame to a microtask instead of emitting synchronously.
    queueMicrotask(() => {
      this.onMessage({
        type: 'SYSTEM_INFO',
        data: { gatewayMode: 'MOCK' as const, geofenceActive: false, brokerConnected: true }
      });
      this.onStatusChange('CONNECTED');
      this.emitState();
      this.timer = window.setInterval(() => {
        const now = performance.now();
        this.engine.tick((now - this.last) / 1000);
        this.last = now;
        this.emitState();
      }, 100);
    });
  }

  private emitState() {
    this.onMessage({ type: 'OPERATIONS_STATE', data: this.engine.snapshot() });
  }

  authenticate(_token: string) {}

  send(data: object): boolean {
    const message = data as { type?: string; data?: { id?: string } };
    if (message.type !== 'COMMAND') return false;
    const command = parseCommand(message.data);
    const result = command
      ? this.engine.dispatch(command)
      : { requestId: message.data?.id ?? '', accepted: false, message: '无效指令' };
    this.onMessage({ type: 'COMMAND_RESULT', data: result });
    this.emitState();
    return true;
  }

  destroy() {
    clearInterval(this.timer);
  }
}
