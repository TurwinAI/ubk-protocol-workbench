import { parseRecipeStructure } from '../../utils/recipeParser';
import type { CompositeDocAst, CompositeDocNode, ExecutionNode } from './types';

export interface ExecutionPlan {
  id: string;
  title: string;
  intent: string;
  nodes: ExecutionNode[];
  ast: CompositeDocAst;
  source: {
    recipeText: string;
  };
}

const mapTypeToModality = (type: CompositeDocNode['type']): ExecutionNode['modality'] => {
  if (type === 'image') return 'image';
  if (type === 'diagram' || type === 'chart') return 'diagram';
  return 'text';
};

const inferModality = (text: string): ExecutionNode['modality'] => {
  const lowered = text.toLowerCase();

  // ── Diagram / chart signals (check first – more specific than generic image) ──
  if (
    lowered.includes('diagram') ||
    lowered.includes('flowchart') ||
    lowered.includes('flow chart') ||
    lowered.includes('sequence diagram') ||
    lowered.includes('class diagram') ||
    lowered.includes('state diagram') ||
    lowered.includes('er diagram') ||
    lowered.includes('entity relationship') ||
    lowered.includes('dependency graph') ||
    lowered.includes('call graph') ||
    lowered.includes('architecture diagram') ||
    lowered.includes('system architecture') ||
    lowered.includes('process flow') ||
    lowered.includes('data flow') ||
    lowered.includes('mermaid') ||
    lowered.includes('mindmap') ||
    lowered.includes('gantt') ||
    lowered.includes('org chart') ||
    lowered.includes('orgchart') ||
    lowered.includes('chart') ||
    lowered.includes('graph ')
  ) {
    return 'diagram';
  }

  // ── Image / visual signals ──
  if (
    lowered.includes('generate image') ||
    lowered.includes('image') ||
    lowered.includes('render') ||
    lowered.includes('sketch') ||
    lowered.includes('draw ') ||
    lowered.includes('illustrat') ||          // illustrate, illustration, illustrated
    lowered.includes('visualiz') ||           // visualize, visualization
    lowered.includes('visual ') ||            // "visual representation", "visual overview"
    lowered.includes('depict') ||
    lowered.includes('mockup') ||
    lowered.includes('mock-up') ||
    lowered.includes('wireframe') ||
    lowered.includes('infographic') ||
    lowered.includes('picture') ||
    lowered.includes('photo') ||
    lowered.includes('icon design') ||
    lowered.includes('logo design') ||
    lowered.includes('graphic') ||
    /\bdesign\s+(a|the|an)\s+(visual|graphic|layout|banner|poster|cover)\b/.test(lowered)
  ) {
    return 'image';
  }
  return 'text';
};

const inferArtifactType = (text: string): CompositeDocNode['type'] => {
  const lowered = text.toLowerCase();
  const firstMatchIndex = (hints: string[]): number => {
    let best = -1;
    for (const hint of hints) {
      const idx = lowered.indexOf(hint);
      if (idx === -1) continue;
      if (best === -1 || idx < best) best = idx;
    }
    return best;
  };

  if (
    lowered.includes('html') ||
    lowered.includes('web page') ||
    lowered.includes('webpage') ||
    lowered.includes('<html') ||
    lowered.includes('<div')
  ) {
    return 'html';
  }
  const videoIdx = firstMatchIndex(['video', 'mp4', 'webm', 'screencast', 'demo clip', 'video clip']);
  const audioIdx = firstMatchIndex(['audio', 'podcast', 'voiceover', 'voice-over', 'narration']);
  if (videoIdx !== -1 || audioIdx !== -1) {
    if (videoIdx === -1) return 'audio';
    if (audioIdx === -1) return 'video';
    return audioIdx < videoIdx ? 'audio' : 'video';
  }

  // ── Chart-specific detection (before generic diagram) ──
  if (
    /\b(bar|line|area|pie|scatter|histogram|donut|radar|bubble|heatmap|treemap|waterfall|funnel)\s+(chart|graph|plot)\b/i.test(text) ||
    /\bchart\b/i.test(text) ||
    /\bdata\s+vizuali[sz]/i.test(text) ||
    /\bdata\s+visuali[sz]/i.test(text) ||
    /\b(plot|graph)\s+(the|this|a|an|of)\b/i.test(text)
  ) {
    return 'chart';
  }

  const modality = inferModality(text);
  if (modality === 'image') return 'image';
  if (modality === 'diagram') return 'diagram';
  return 'text';
};

const STRONG_ARTIFACT_HINTS: Record<CompositeDocNode['type'], RegExp[]> = {
  text: [],
  code: [
    /\b(write|generate|produce|return)\b[^\n.]{0,80}\b(code|script|function|module|class)\b/i,
    /\b(source code|typescript|javascript|python|sql)\b/i,
  ],
  json: [
    /\b(strict|valid|machine-readable)\s+json\b/i,
    /\bjson\s+(object|array|payload|schema|artifact|output)\b/i,
  ],
  html: [
    /\b(html|web page|webpage|ui preview|landing page|interactive page)\b/i,
    /<html|<body|<div/i,
  ],
  image: [
    /\b(render|generate|create|draw|sketch|illustrate|produce|design|depict)\b[^\n.]{0,80}\b(image|visual|illustration|picture|photo|mockup|mock-up|wireframe|sketch|infographic|graphic|icon|logo|banner|poster|cover)\b/i,
    /\b(image|visual|illustration|picture)\s+(artifact|output|representation|overview)\b/i,
    /\bvisuali[sz](e|ation)\b/i,
    /\b(graphic|pictorial|visual)\s+(depiction|representation|summary)\b/i,
  ],
  diagram: [
    /\bmermaid\b/i,
    /\b(flowchart|flow chart|sequence diagram|class diagram|state diagram|er diagram|entity.relationship|dependency graph|architecture diagram|system architecture|process flow|data flow|call graph|component diagram|network diagram|topology|org\s?chart|mindmap|diagram)\b/i,
    /\b(show|display|present|map out|outline)\b[^\n.]{0,60}\b(architecture|flow|process|system|dependencies|hierarchy|relationships)\b/i,
  ],
  chart: [
    /\b(bar|line|area|pie|scatter|histogram|donut|radar|bubble|heatmap|treemap|waterfall|funnel)\s+(chart|graph|plot)\b/i,
    /\bchart\s+(spec|json|artifact|output)\b/i,
    /\bdata\s+visuali[sz]/i,
    /\b(plot|graph)\s+(the|this|a|an|of)\b/i,
  ],
  table: [
    /\b(table|csv|tabular|spreadsheet)\b/i,
  ],
  audio: [
    /\b(audio|narration|voiceover|voice-over|podcast|mp3|wav|sound\s?clip|audio\s?clip)\b/i,
  ],
  video: [
    /\b(video|walkthrough|screencast|demo clip|mp4|webm|animation|video clip|screen recording)\b/i,
  ],
  file: [
    /\b(file|download|attachment|archive)\b/i,
  ],
  report: [
    /\b(report|summary|brief|narrative|executive)\b/i,
  ],
};

const hasStrongArtifactHints = (text: string, type: CompositeDocNode['type']): boolean => {
  const hints = STRONG_ARTIFACT_HINTS[type];
  if (!hints || hints.length === 0) return false;
  return hints.some((pattern) => pattern.test(text));
};

const resolveNodeOutputType = (
  declaredType: CompositeDocNode['type'],
  description: string
): CompositeDocNode['type'] => {
  const inferredType = inferArtifactType(description);
  if (declaredType === inferredType) return declaredType;

  // Only auto-correct when the planner labeled a node as plain text/report but the spec strongly requests another modality.
  if (declaredType !== 'text' && declaredType !== 'report') return declaredType;
  if (inferredType === 'text' || inferredType === 'report') return declaredType;

  // Accept the inferred type if strong artifact hints match OR the inferred type has clear keyword signals.
  // This broadens the gate so that visual content classified by inferModality/inferArtifactType is accepted
  // even when STRONG_ARTIFACT_HINTS don't have a specific regex match (the keyword detection is strong enough).
  if (inferredType === 'image' || inferredType === 'diagram' || inferredType === 'chart' ||
      inferredType === 'audio' || inferredType === 'video') {
    return inferredType;
  }
  if (!hasStrongArtifactHints(description, inferredType)) return declaredType;
  return inferredType;
};

const makeNodeId = (idx: number) => `node_${String(idx + 1).padStart(2, '0')}`;

export const buildExecutionPlanFromAst = (input: {
  ast: CompositeDocAst;
  intent: string;
  recipeText: string;
  titleHint?: string;
}): ExecutionPlan => {
  const { ast, intent, recipeText, titleHint } = input;

  // Ensure the AST has stable identifiers/timestamps.
  const normalizedAst: CompositeDocAst = {
    ...ast,
    id: ast.id || `ast_${Date.now()}`,
    createdAt: ast.createdAt || new Date().toISOString(),
    title: (ast.title || titleHint || 'Protocol Execution').trim(),
    nodes: Array.isArray(ast.nodes) ? ast.nodes : []
  };

  const nodes: ExecutionNode[] = normalizedAst.nodes.map(n => {
    const dependsOn = Array.isArray(n.dependsOn) ? n.dependsOn : [];
    const description = (n.spec || n.placeholder || n.title || '').trim() || 'Fulfill this node.';
    const outputType = resolveNodeOutputType(n.type, description);

    return {
      id: n.id,
      name: n.title || n.id,
      description,
      ...(dependsOn.length > 0 ? { dependencies: dependsOn } : {}),
      modality: mapTypeToModality(outputType),
      outputType,
      ...(n.metadata ? { metadata: n.metadata } : {}),
      ...(Array.isArray(n.tools) && n.tools.length > 0 ? { tools: n.tools } : {}),
      ...(n.toolBinding ? { toolBinding: n.toolBinding } : {})
    };
  });

  return {
    id: `plan_${Date.now()}`,
    title: normalizedAst.title || 'Protocol Execution',
    intent,
    nodes,
    ast: normalizedAst,
    source: { recipeText }
  };
};

export const buildExecutionPlanFromRecipeText = (input: {
  recipeText: string;
  intent: string;
  titleHint?: string;
}): ExecutionPlan => {
  const { recipeText, intent, titleHint } = input;

  const parsed = parseRecipeStructure(recipeText);
  const title = (titleHint || parsed.title || 'Protocol Execution').trim();

  const nodes: ExecutionNode[] = [];

  for (const op of parsed.operations ?? []) {
    if (Array.isArray(op.steps) && op.steps.length > 0) {
      for (const step of op.steps) {
        const stepLines = (step.subSteps ?? []).map(sub => `- ${sub.text}`).join('\n');
        const description = [`Operation: ${op.title}`, stepLines].filter(Boolean).join('\n');
        const id = makeNodeId(nodes.length);
        const dependencies = nodes.length > 0 ? [nodes[nodes.length - 1]!.id] : [];

        nodes.push({
          id,
          name: `${op.title} · Step ${step.stepNumber}`,
          description,
          dependencies,
          modality: inferModality(description),
          outputType: inferArtifactType(description)
        });
      }
      continue;
    }

    // Fallback: operation-only node
    const id = makeNodeId(nodes.length);
    const dependencies = nodes.length > 0 ? [nodes[nodes.length - 1]!.id] : [];
    const description = `Operation: ${op.title}`;
    nodes.push({
      id,
      name: op.title,
      description,
      dependencies,
      modality: inferModality(description),
      outputType: inferArtifactType(description)
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      id: makeNodeId(0),
      name: 'Execute Protocol',
      description: recipeText.slice(0, 4000),
      modality: inferModality(recipeText),
      outputType: inferArtifactType(recipeText)
    });
  }

  const createdAt = new Date().toISOString();
  const ast: CompositeDocAst = {
    id: `ast_${Date.now()}`,
    title,
    createdAt,
    nodes: nodes.map(n => ({
      id: n.id,
      type: inferArtifactType(n.description),
      title: n.name,
      status: 'planned',
      placeholder: 'Queued',
      spec: n.description
    })),
    metadata: { intent, source: 'recipeText' }
  };

  return {
    id: `plan_${Date.now()}`,
    title,
    intent,
    nodes,
    ast,
    source: { recipeText }
  };
};
