export type BridgeMode = "simulation" | "window-control";

export type BridgeEventType = "action" | "error" | "status";

export type BridgeEvent = {
  id: string;
  type: BridgeEventType;
  createdAt: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type BridgeState = {
  bridge: {
    mode: BridgeMode;
    targetTitle: string;
    controlEnabled: boolean;
    tokenConfigured: boolean;
    tokenRequired: boolean;
    platform: NodeJS.Platform;
  };
  server: {
    uptimeSeconds: number;
    port: number;
    clients: number;
  };
  recentEvents: BridgeEvent[];
};

export type ControlResult = {
  ok: boolean;
  simulated: boolean;
  message: string;
};
