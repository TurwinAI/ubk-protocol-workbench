import { ExecutionBoundary } from '../acp/contracts/ExecutionBoundaryContract';

export type ArtifactType =
  | 'text'
  | 'code'
  | 'json'
  | 'html'
  | 'image'
  | 'diagram'
  | 'chart'
  | 'table'
  | 'audio'
  | 'video'
  | 'file'
  | 'report';

export type VisualAspectRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16';

export type VisualRenderMode = 'image' | 'mermaid' | 'chartSpec';

export interface VisualPlan {
  renderMode?: VisualRenderMode;
  prompt?: string;
  style?: string;
  aspectRatio?: VisualAspectRatio;
  mermaid?: string;
  chartSpec?: string | Record<string, unknown>;
  chartSpecFormat?: string;
  [key: string]: unknown;
}

export interface ArtifactExecutionVerification {
  status: 'pass' | 'fail' | 'unknown';
  reason?: string;
  [key: string]: unknown;
}

export interface ArtifactExecutionMetadata {
  runnable?: boolean;
  verification?: ArtifactExecutionVerification;
  [key: string]: unknown;
}

export interface ArtifactMetadata extends Record<string, unknown> {
  visualPlan?: VisualPlan;
  execution?: ArtifactExecutionMetadata;
}

export type GeminiBuiltInTool = 'googleSearch' | 'urlContext' | 'codeExecution' | 'fileSearch';

export interface Artifact {
  id?: string;
  type: ArtifactType;
  title?: string;
  /**
   * Primary payload for the artifact.
   * - For `text|code|json|report`: raw string
   * - For `image`: URL or data URI (base64)
   * - For `audio|video`: URL or data URI (base64)
   * - For `diagram|chart`: image URL, SVG markup, mermaid text, or chart spec JSON
   */
  content: string;
  language?: string;
  mimeType?: string;
  metadata?: ArtifactMetadata;
}

export interface ToolBinding {
  toolName: string;
  arguments: Record<string, unknown>;
}

export type NodeStatus = 'planned' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked_for_human';

export interface ExecutionNode {
  id: string;
  name: string;
  description: string;
  dependencies?: string[];
  toolBinding?: ToolBinding;
  /**
   * Expected primary artifact type for this node (derived from the CompositeDoc AST).
   * Executors should prefer producing this type when possible.
   */
  outputType?: ArtifactType;
  /**
   * Hint for routing. The executor may still override based on content.
   */
  modality?: 'text' | 'image' | 'diagram';
  /**
   * Built-in Gemini tools to enable for this node (Gemini 3 supports combining tools with structured outputs).
   * Keys follow the @google/genai JS config naming.
   */
  tools?: GeminiBuiltInTool[];
  /**
   * Planner-provided metadata for executor routing (e.g., visualPlan hints).
   */
  metadata?: Record<string, unknown>;
  /**
   * Cryptographic Decentralized Identifier (DID) representing the executing agent.
   */
  agentDid?: string;
}

export interface NodeExecutionState {
  id: string;
  status: NodeStatus;
  startTime?: number;
  endTime?: number;
  attempts: number;
  result?: unknown;
  error?: string;
  artifacts?: Artifact[];
  /**
   * The DID of the agent that actually fulfilled this node.
   */
  agentDid?: string;
}

export interface ProvenanceEvent {
  ts: string;
  type: 'plan' | 'dispatch' | 'complete' | 'error';
  nodeId?: string;
  model?: string;
  agentDid?: string;
  details?: Record<string, unknown>;
}

export interface ExecutionContextState {
  nodes: Record<string, NodeExecutionState>;
  provenance: ProvenanceEvent[];
  boundary?: ExecutionBoundary;
}

export type CompositeNodeStatus = 'planned' | 'fulfilling' | 'fulfilled' | 'failed';

export interface CompositeDocNode {
  id: string;
  type: ArtifactType;
  title?: string;
  status: CompositeNodeStatus;
  artifactId?: string;
  placeholder?: string;
  /**
   * Self-contained generation spec for this node (what should be produced).
   * The planner should populate this so executors can fulfill nodes deterministically.
   */
  spec?: string;
  dependsOn?: string[];
  toolBinding?: ToolBinding;
  /**
   * Built-in Gemini tools to enable while fulfilling this node.
   * Example: ["googleSearch", "codeExecution"]
   */
  tools?: GeminiBuiltInTool[];
  metadata?: Record<string, unknown>;
}

export interface CompositeDocAst {
  id: string;
  title?: string;
  createdAt: string;
  nodes: CompositeDocNode[];
  metadata?: Record<string, unknown>;
}
