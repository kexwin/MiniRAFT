export interface StrokeData {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
  timestamp: number;
}

export interface ClientMessage {
  type: 'stroke' | 'sync-request' | 'clear-all';
  data?: StrokeData;
}

export interface ServerMessage {
  type: 'stroke-committed' | 'state-sync' | 'status' | 'clear' | 'error' | 'leader-info';
  data?: any;
}
