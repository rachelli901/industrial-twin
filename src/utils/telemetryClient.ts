import { parseOperationsState } from '../domain/operations';
import type { CommandResult, OperationsState } from '../domain/operations';
import { parsePose, parseSlot } from './telemetryProtocol';
import type { Pose } from './telemetryProtocol';
export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'MOCK_MODE' | 'STALE';
export type TelemetryMessage =
  | { type: 'AGV_POSE'; data: Pose }
  | { type: 'SLOT_UPDATE'; data: NonNullable<ReturnType<typeof parseSlot>> }
  | { type: 'SYSTEM_INFO'; data: { gatewayMode: 'MOCK' | 'MQTT'; geofenceActive: boolean; brokerConnected: boolean } }
  | { type: 'GEOFENCE_STATUS'; data: { active: boolean } }
  | { type: 'OPERATIONS_STATE'; data: OperationsState }
  | { type: 'COMMAND_RESULT'; data: CommandResult }
  | { type: 'COMMAND_ERROR'; data: { message: string } };

export class TelemetryClient {
  private url: string;
  private ws: WebSocket | null = null;
  private heartbeatTimer: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimer = 0;
  private authenticated = false;
  private brokerConnected = false;
  private lastSeen = 0;
  private lastPose = new Map<string, number>();

  private baseReconnectDelay: number = 1000;

  private isDestroyed: boolean = false;

  public onAuthRequired: () => void = () => {};
  public onAuthFailure: () => void = () => {};
  public onStatusChange: (status: ConnectionStatus) => void = () => {};
  public onMessage: (msg: TelemetryMessage) => void = () => {};

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.handleConnectionFail();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.authenticated = false;
      this.lastSeen = Date.now();
      this.lastPose.clear();
      this.onStatusChange('RECONNECTING');
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'AUTH_REQUIRED') {
          const token = sessionStorage.getItem('gateway-token');
          if (token) this.ws?.send(JSON.stringify({ type: 'AUTH', token }));
          else this.onAuthRequired();
          return;
        }
        this.lastSeen = Date.now();
        if (payload.type === 'PONG') return;
        let message: TelemetryMessage | null = null;
        if (payload.type === 'AGV_POSE') {
          const data = parsePose(payload.data);
          if (data) { this.lastPose.set(data.id, Date.now()); message = { type: 'AGV_POSE', data }; }
        } else if (payload.type === 'SLOT_UPDATE') {
          const data = parseSlot(payload.data);
          if (data) message = { type: 'SLOT_UPDATE', data };
        } else if (payload.type === 'SYSTEM_INFO' && ['MOCK', 'MQTT'].includes(payload.data?.gatewayMode) &&
                   typeof payload.data?.geofenceActive === 'boolean' && typeof payload.data?.brokerConnected === 'boolean') {
          this.authenticated = true;
          this.reconnectAttempts = 0;
          this.brokerConnected = payload.data.brokerConnected;
          message = { type: 'SYSTEM_INFO', data: payload.data };
        } else if (payload.type === 'GEOFENCE_STATUS' && typeof payload.data?.active === 'boolean') {
          message = { type: 'GEOFENCE_STATUS', data: { active: payload.data.active } };
        } else if (payload.type === 'OPERATIONS_STATE') {
          const data = parseOperationsState(payload.data);
          if (data) message = { type: 'OPERATIONS_STATE', data };
        } else if (payload.type === 'COMMAND_RESULT' && typeof payload.data?.requestId === 'string' && typeof payload.data?.accepted === 'boolean' && typeof payload.data?.message === 'string') {
          message = { type: 'COMMAND_RESULT', data: payload.data };
        } else if (payload.type === 'COMMAND_ERROR' && typeof payload.data?.message === 'string') {
          message = { type: 'COMMAND_ERROR', data: { message: payload.data.message } };
        }
        if (this.authenticated) {
          const fresh = ['AGV_01', 'AGV_02'].every(id => Date.now() - (this.lastPose.get(id) ?? 0) < 5000);
          this.onStatusChange(this.brokerConnected && fresh ? 'CONNECTED' : 'STALE');
          if (message) this.onMessage(message);
        }
      } catch (e) {
        console.warn('[Telemetry] 报文反序列化失败:', e);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };

    this.ws.onclose = (event) => {
      this.authenticated = false;
      this.stopHeartbeat();
      if (this.isDestroyed) return;
      if (event.code === 1008) {
        sessionStorage.removeItem('gateway-token');
        this.onStatusChange('STALE');
        this.onAuthFailure();
        return;
      }
      if (!this.isDestroyed) {
        this.handleConnectionFail();
      }
    };
  }

  // 心跳维持
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (Date.now() - this.lastSeen > 15000) { this.ws?.close(); return; }
      if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
        if (!this.brokerConnected || ['AGV_01', 'AGV_02'].some(id => Date.now() - (this.lastPose.get(id) ?? 0) > 5000)) this.onStatusChange('STALE');
      }
    }, 3000); // 3 秒探测，15 秒无消息则重连
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
  }

  // 断网自愈与退避处理
  private handleConnectionFail() {
    this.stopHeartbeat();
    this.reconnectAttempts++;

    this.onStatusChange('RECONNECTING');
    const delay = Math.min(this.baseReconnectDelay * 2 ** Math.min(this.reconnectAttempts - 1, 5), 30000);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  public authenticate(token: string) {
    if (this.isDestroyed || !token.trim()) return;
    sessionStorage.setItem('gateway-token', token.trim());
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'AUTH', token: token.trim() }));
    else { clearTimeout(this.reconnectTimer); this.connect(); }
  }

  // Only authenticated sockets may issue commands.
  public send(data: object) {
    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  public destroy() {
    this.isDestroyed = true;
    this.stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}