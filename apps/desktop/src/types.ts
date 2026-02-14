export interface Channel {
  id: string;
  name: string;
  path: string;
  children: Channel[];
}

export type ThreadStatus = "active" | "snoozed" | "done";
export type Theme = "light" | "dark";
export type AppView = "threads" | "replies" | "settings";

export interface Thread {
  id: string;
  channelId: string;
  title: string;
  status: ThreadStatus;
  createdAt: number;
  lastActivityAt: number;
  lastReadAt: number | null;
  ptyId: number | null;
  hasUnread: boolean;
  snoozeUntil: number | null;
  snoozeDue: boolean;
  lastOutputPreview: string | null;
  ptyRunning: boolean;
  ptyExitCode: number | null;
  autoTitled: boolean;
}

export interface ScheduledMessage {
  id: string;
  channelId: string;
  prompt: string;
  scheduledAt: number;
}

export interface AppState {
  channels: Channel[];
  threads: Thread[];
  selectedChannelId: string | null;
  selectedThreadId: string | null;
  rootPath: string | null;
  theme: Theme;
  currentView: AppView;
  scheduledMessages: ScheduledMessage[];
  autoRunCommand: string | null;
}
