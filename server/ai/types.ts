export interface TextProvider {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AudioProvider extends TextProvider { voice: string }
export interface ModelConfig {
  mode: 'demo' | 'live';
  text: TextProvider;
  audio: AudioProvider;
}
export interface Message { role: 'user' | 'assistant'; content: string }
export interface PageContext {
  park: string;
  view: string;
  topic: { name: string; summary: string; source: string } | null;
}
export type ToolOutput = Record<string, unknown> & { error?: string };
export interface Trace {
  id: string;
  name: string;
  args: unknown;
  result: ToolOutput | null;
  duration: number;
  status: 'running' | 'done' | 'error';
}
export type AgentEvent =
  | { type: 'mode'; mode: string }
  | { type: 'status'; message: string }
  | { type: 'tool_start' | 'tool_end'; trace: Trace }
  | { type: 'input_transcript'; transcript: string }
  | { type: 'answer_delta'; content: string }
  | { type: 'audio_delta'; audio: string; sampleRate: number }
  | { type: 'answer'; content: string; traces: Trace[]; model: string; usage?: { total_tokens: number } }
  | { type: 'error'; error: string; code: string };
export interface AgentResult { content: string; traces: Trace[]; usage?: { total_tokens: number } }
export interface AgentInput {
  messages: Message[];
  city: string;
  pageContext?: PageContext;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}
