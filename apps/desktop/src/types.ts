export interface Channel {
  id: string;
  name: string;
  path: string;
  children: Channel[];
}

export type ThreadStatus = "active" | "snoozed" | "done" | "inactive";
export type ThreadType = "terminal" | "chat";
export type Theme = "light" | "dark";
export type AppView = "threads" | "replies" | "settings";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface ProviderConfig {
  id: string;
  type: "openai" | "anthropic" | "ollama";
  label: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel: string;
}

export interface ScheduledMessage {
  id: string;
  channelId: string;
  prompt: string;
  scheduledAt: number;
}

export interface Thread {
  id: string;
  channelId: string;
  title: string;
  status: ThreadStatus;
  createdAt: number;
  lastActivityAt: number;
  lastReadAt: number | null;
  hasUnread: boolean;
  snoozeUntil: number | null;
  snoozeDue: boolean;
  lastOutputPreview: string | null;

  // Thread type
  threadType: ThreadType;

  // Terminal-specific
  ptyId: number | null;
  ptyRunning: boolean;
  ptyExitCode: number | null;
  autoTitled: boolean;

  // Chat-specific
  chatMessages: ChatMessage[];
  model: string | null;
  providerId: string | null;
  isStreaming: boolean;
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
  providers: ProviderConfig[];
  defaultProviderId: string | null;
}
