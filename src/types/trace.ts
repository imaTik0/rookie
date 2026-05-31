export type TraceId = string & { __traceId: never };

export interface TraceEvent {
    id: string;
    timestamp: number;
    type: "LLM_CALL" | "TOOL_CALL" | "AGENT_THOUGHT" | "SYSTEM_LOG" | "RESEARCH_FEEDBACK";
    content: any;
    tokens?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    durationMs?: number;
}

export interface Trace {
    id: TraceId;
    testSuiteId?: string;
    reportId?: string;
    goal?: string;
    phase: string;
    createdAt: number;
    updatedAt: number;
    events: TraceEvent[];
}
