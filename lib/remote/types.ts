export type RemoteSource = "ORB" | "TELEGRAM" | "DISCORD";

export type RemoteCommand = {
  id: string;
  source: Exclude<RemoteSource, "ORB">;
  senderId: string;
  command: string;
  receivedAt: number;
};

export type RemoteCommandResult = {
  id: string;
  source: Exclude<RemoteSource, "ORB">;
  reply: string;
  ok: boolean;
};
