export interface RecipeSection {
  id: string;
  title: string;
  content: string;
  icon: string;
  color: string;
  order: number;
  isComplete: boolean;
  estimatedHeight: number;
  index: number;
}

export interface ParsedRecipe {
  sections: RecipeSection[];
  executionTrace?: string; // New field for the raw algorithmic trace
  metadata: {
    totalSections: number;
    estimatedTotalHeight: number;
    hasStructuredContent: boolean;
  };
}

// Import the RecipeStructure interface from the types file
import { RecipeStructure, RecipeOperation, RecipeStep } from '../types/recipeVisualizer';

/**
 * Helper function to remove markdown headers from text
 */
function removeMarkdownHeaders(text: string): string {
  return text.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * If a recipe lacks an explicit Title header but begins with a standalone
 * name line before other canonical headers (Goal/Principles/Operations/Steps/Final Output),
 * promote that line into a proper Title header so it can be parsed reliably.
 */
function coerceUnlabeledTitle(recipeContent: string): string {
  const lines = recipeContent.split('\n');
  if (lines.length === 0) return recipeContent;

  const titleHeaderPattern =
    /^(?:#{1,6}\s*)?(?:\*\*)?(?:Title)(?:\*\*)?\s*:?\s*.+$/i;
  const directTitleContentPattern =
    /^(?:#{1,6}\s+.+|\*\*Algorithmic Recipe for .+\*\*)$/i;
  const hasExplicitTitle = lines.some(line => {
    const trimmed = (line || '').trim();
    return titleHeaderPattern.test(trimmed) || directTitleContentPattern.test(trimmed);
  });
  if (hasExplicitTitle) return recipeContent;

  const firstNonEmptyIndex = lines.findIndex(line => (line || '').trim().length > 0);
  if (firstNonEmptyIndex === -1) return recipeContent;

  const canonicalHeaderPattern =
    /^(?:#{1,6}\s*)?(?:\*\*)?(Goal|Principles?|Operations?|Steps|Final Output)(?:\*\*)?\s*:?.*$/i;
  const firstHeaderIndex = lines.findIndex((line, index) => {
    if (index <= firstNonEmptyIndex) return false;
    return canonicalHeaderPattern.test((line || '').trim());
  });
  if (firstHeaderIndex === -1) return recipeContent;

  const candidateLines = lines
    .slice(firstNonEmptyIndex, firstHeaderIndex)
    .map(line => (line || '').trim())
    .filter(Boolean);
  if (candidateLines.length === 0) return recipeContent;

  const candidateTitle = candidateLines.join(' ').replace(/\s+/g, ' ').trim();
  if (candidateTitle.length < 3 || candidateTitle.length > 200) return recipeContent;

  const rest = lines.slice(firstHeaderIndex).join('\n').trimStart();
  return `Title: ${candidateTitle}\n${rest}`.trim();
}

/**
 * Enhanced recipe content parser with stable section identification
 * ENFORCES: Title, Goal, Principles, Operations, Steps structure
 * HANDLES: Separation of Execution Trace (Section 1) and Verified Recipe (Section 2)
 */
export function parseRecipeContent(content: string): ParsedRecipe {
  if (!content || !content.trim()) {
    return {
      sections: [],
      metadata: {
        totalSections: 0,
        estimatedTotalHeight: 0,
        hasStructuredContent: false
      }
    };
  }

  // --- SPLIT LOGIC START ---
  let recipeContentToParse = content;
  let executionTraceString = '';

  // Check for explicit section markers (support both markdown headings and plain text)
  const section1Marker = /(?:^|\n)\s*(?:#{1,6}\s*)?SECTION 1:\s*TURWIN EXECUTION TRACE\s*(?:\n|$)/i;
  const section2Marker = /(?:^|\n)\s*(?:#{1,6}\s*)?SECTION 2:\s*VERIFIED RECIPE\s*(?:\n|$)/i;

  if (section2Marker.test(content)) {
    const parts = content.split(section2Marker);
    const tracePart = parts[0] || '';
    recipeContentToParse = (parts[1] || '').trim(); // Only parse Section 2 as the recipe (if present)

    // Extract trace from Section 1 (if present)
    if (tracePart && tracePart.trim()) {
      const traceMatch = tracePart.match(/BEGIN_TRACE([\s\S]*?)END_TRACE/);
      if (traceMatch && traceMatch[1]) {
        executionTraceString = traceMatch[1].trim();
      } else if (section1Marker.test(tracePart)) {
        // Fallback: take everything after SECTION 1 up to SECTION 2
        const s1Parts = tracePart.split(section1Marker);
        if (s1Parts.length > 1 && s1Parts[1]) {
          executionTraceString = s1Parts[1].trim();
        }
      } else {
        // Last resort: if we have content before Section 2, treat it as trace
        executionTraceString = tracePart.trim();
      }
    }
  }
  
  // NEW: Also check for TURWIN_TRACE_BEGIN/END markers (from turwinKernel.ts)
  const turwinTraceMatch = content.match(/<!-- TURWIN_TRACE_BEGIN -->([\s\S]*?)<!-- TURWIN_TRACE_END -->/);
  if (turwinTraceMatch && turwinTraceMatch[1]) {
    // Extract the trace content (strip the code block wrapper if present)
    let traceContent = turwinTraceMatch[1].trim();
    traceContent = traceContent.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    executionTraceString = traceContent;
    // Remove the trace section from the recipe content to parse
    recipeContentToParse = content.replace(/<!-- TURWIN_TRACE_BEGIN -->[\s\S]*?<!-- TURWIN_TRACE_END -->/, '').trim();
  }
  // --- SPLIT LOGIC END ---

  // CLEANUP: Remove wrapping markdown code blocks from the recipe content if present
  // This handles cases where the LLM wraps the entire Section 2 in ```markdown ... ```
  recipeContentToParse = recipeContentToParse.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
  recipeContentToParse = recipeContentToParse.trim();
  recipeContentToParse = coerceUnlabeledTitle(recipeContentToParse);

  const sectionConfigs = [
    { 
      id: 'title', 
      title: 'Title', 
      icon: 'file-text', 
      color: '-500/20 -500/20 border-indigo-500/30',
      patterns: [
        /^\*\*Title\*\*:?\s*(.*)$/i,
        /^Title:?\s*(.*)$/i,
        /^TITLE:?\s*(.*)$/,
        /^\*\*Algorithmic Recipe for (.+)\*\*$/i,
        /^#\s+(.+)$/,       // Top-level headers
        /^##\s+Title:?\s*(.*)$/i,
        /^###\s+Title:?\s*(.*)$/i
      ],
      order: 1,
      numberingScheme: 'none' as const
    },
    { 
      id: 'goal', 
      title: 'Goal', 
      icon: 'target', 
      color: '-500/20 -500/20 border-blue-500/30',
      patterns: [
        /^\*\*Goal\*\*:?\s*(.*)$/i,
        /^Goal:?\s*(.*)$/i,
        /^GOAL:?\s*(.*)$/,
        /^\*\*(objective|purpose|aim)\*\*:?\s*(.*)$/i,
        /^(objective|purpose|aim):?\s*(.*)$/i,
        /^\*\*To (.+)\*\*$/i,
        /^To (.+)$/i,
        /^##\s+Goal:?\s*(.*)$/i,
        /^###\s+Goal:?\s*(.*)$/i
      ],
      order: 2,
      numberingScheme: 'none' as const
    },
    { 
      id: 'principles', 
      title: 'Principles', 
      icon: 'lightbulb', 
      color: '-500/20 -500/20 border-purple-500/30',
      patterns: [
        /^\*\*Principles?\*\*:?\s*(.*)$/i,
        /^Principles?:?\s*(.*)$/i,
        /^PRINCIPLES?:?\s*(.*)$/,
        /^\*\*(rules?|guidelines?|foundations?)\*\*:?\s*(.*)$/i,
        /^(rules?|guidelines?|foundations?):?\s*(.*)$/i,
        /^##\s+Principles?:?\s*(.*)$/i,
        /^###\s+Principles?:?\s*(.*)$/i,
        // Canonical Invariants
        /^\*\*Canonical Invariants?\*\*:?\s*(.*)$/i,
        /^Canonical Invariants?:?\s*(.*)$/i,
        /^##\s+Canonical Invariants?:?\s*(.*)$/i
      ],
      order: 3,
      numberingScheme: 'bullet' as const
    },
    { 
      id: 'operations', 
      title: 'Operations', 
      icon: 'cog', 
      color: '-500/20 -500/20 border-green-500/30',
      patterns: [
        /^\*\*Operations?\*\*:?\s*(.*)$/i,
        /^Operations?:?\s*(.*)$/i,
        /^OPERATIONS?:?\s*(.*)$/,
        /^\*\*(actions|methods|processes|procedures)\*\*:?\s*(.*)$/i,
        /^(actions|methods|processes|procedures):?\s*(.*)$/i,
        /^##\s+Operations?:?\s*(.*)$/i,
        /^###\s+Operations?:?\s*(.*)$/i
      ],
      order: 4,
      numberingScheme: 'numeric' as const
    },
    { 
      id: 'steps', 
      title: 'Steps', 
      icon: 'list', 
      color: '-500/20 -500/20 border-orange-500/30',
      patterns: [
        /^\*\*Steps?\*\*:?\s*(.*)$/i,
        /^Steps?:?\s*(.*)$/i,
        /^STEPS?:?\s*(.*)$/,
        /^\*\*(instructions?|implementations?|executions?|procedures?)\*\*:?\s*(.*)$/i,
        /^(instructions?|implementations?|executions?|procedures?):?\s*(.*)$/i,
        /^##\s+Steps?:?\s*(.*)$/i,
        /^###\s+Steps?:?\s*(.*)$/i,
        // Individual step headers (e.g., **Step 1: [Phase Name]**)
        /^\*\*Step\s+\d+:?\s*(.*)$/i
      ],
      order: 5,
      numberingScheme: 'numeric' as const
    },
    { 
      id: 'final_output', 
      title: 'Final Output', 
      icon: 'check-circle', 
      color: '-500/20 -500/20 border-emerald-500/30',
      patterns: [
        /^\*\*Final Output\*\*:?\s*(.*)$/i,
        /^Final Output:?\s*(.*)$/i,
        /^FINAL OUTPUT:?\s*(.*)$/,
        /^##\s+Final Output:?\s*(.*)$/i,
        /^###\s+Final Output:?\s*(.*)$/i
      ],
      order: 6,
      numberingScheme: 'none' as const
    }
  ];

  const lines = recipeContentToParse.split('\n');
  const sections: RecipeSection[] = [];
  let currentSection: Partial<RecipeSection> | null = null;
  let buffer: string[] = [];
  let hasStructuredContent = false;
  
  // Track numbering for different schemes
  const numberingCounters = {
    numeric: 1,
    phase: 1,
    bullet: 0
  };

  const saveCurrentSection = () => {
    if (currentSection && buffer.length > 0) {
      const rawContent = buffer.join('\n').trim();
      if (rawContent) {
        // Apply section-aware numbering and clean up content
        const processedContent = applySectionNumbering(
          rawContent, 
          currentSection!.id || '', 
          sectionConfigs.find(c => c.id === currentSection!.id)?.numberingScheme || 'none',
          { numeric: 1, phase: 1, bullet: 0 } // Fresh counters for each section
        );
        
        sections.push({
          ...currentSection,
          content: processedContent,
          isComplete: validateSectionCompletion(processedContent, currentSection!.id || ''),
          estimatedHeight: estimateContentHeight(processedContent),
          index: sections.length // Assign the current length as the index
        } as RecipeSection);
      }
      buffer = [];
    }
  };

  // Track if we've found the first title to filter out content before it
  let foundFirstTitle = false;
  
  // Process content line by line with enhanced section detection
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    const trimmedLine = line.trim();

    // STOP PROCESSING Section 2 if we hit algorithmic logs that leaked from Section 1
    // or if we hit the Performance Note which should stay in the trace
    if (/^(?:#{1,6}\s*)?(Performance Note|Provenance|TCB|CSB_\d+|ASTOK|INV\(|TypeOK|Protocol Tags)/i.test(trimmedLine)) {
      if (import.meta.env.DEV) {
        console.log(`🛑 Stopping Section 2 parse at leaked metadata: "${trimmedLine.substring(0, 30)}..."`);
      }
      break; 
    }

    // Skip empty lines at section boundaries but preserve them within sections
    if (!trimmedLine && buffer.length === 0) {
      continue;
    }

    // Check for section headers with improved pattern matching
    let foundSection = false;
    for (const config of sectionConfigs) {
      for (const pattern of config.patterns) {
        const match = pattern.exec(trimmedLine);
        if (match) {
          // ENHANCEMENT: If we found a header for the SAME section ID that we are already in,
          // don't start a new section. Just treat this line as content/header within the same section.
          // This prevents fragmentation when LLMs output individual headers like "**Step 1:**", "**Step 2:**" etc.
          if (currentSection && currentSection.id === config.id) {
            // It's just another header in the current section, let it be buffered normally
            break; 
          }

          // Mark that we found a section header
          foundFirstTitle = true;
          
          // Save previous section before starting new one
          saveCurrentSection();
          
          // Extract section title and initial content
          let sectionTitle = config.title;
          let initialContent = '';
          
          if (config.id === 'title' && match[1]) {
            sectionTitle = removeMarkdownHeaders(match[1].trim());
            initialContent = removeMarkdownHeaders(match[1].trim());
          } else if (match[1] && match[1].trim()) {
            // For other sections, if there's content after the colon, include it
            initialContent = removeMarkdownHeaders(match[1].trim());
          } else if (match[2] && match[2].trim()) {
            // Handle patterns with multiple capture groups
            initialContent = removeMarkdownHeaders(match[2].trim());
          }
            
            // ENHANCEMENT: If no initial content found (or it's just empty string), look ahead to next non-empty line
            // This handles LLM output format where content follows header on next line
            if ((!initialContent || initialContent.trim() === '') && (config.id === 'title' || config.id === 'goal')) {
              // Look ahead to the next non-empty line
              for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
                const nextLine = (lines[j] || '').trim();
                if (nextLine && !nextLine.startsWith('**') && !nextLine.startsWith('#')) {
                  // Remove markdown formatting (brackets, quotes, etc.)
                  initialContent = nextLine
                    .replace(/^\[+|\]+$/g, '')  // Remove surrounding brackets
                    .replace(/^["']+|["']+$/g, '') // Remove surrounding quotes
                    .trim();
                  // Skip this line in main loop since we consumed it
                  i = j;
                  break;
                }
              }
            }
            
            currentSection = {
              id: config.id,
              title: sectionTitle,
              icon: config.icon,
              color: config.color,
              order: config.order
            };
            
            // Add initial content if found
            if (initialContent) {
              buffer.push(initialContent);
            }
            
          hasStructuredContent = true;
          foundSection = true;
          break;
        }
      }
      if (foundSection) break;
    }

    // Only add content if we've found the first title and we're in a section
    if (!foundSection && foundFirstTitle && currentSection) {
      // Only add non-empty lines or preserve spacing within sections
      if (trimmedLine || buffer.length > 0) {
        if (import.meta.env.DEV) {
          console.log(`📝 Buffer add for ${currentSection.id}: "${trimmedLine.substring(0, 50)}"`);
        }
        buffer.push(line || '');
      }
    }
  }

  // Save the last section
  saveCurrentSection();

  // If no structured content found, create a single content section
  if (!hasStructuredContent && content.trim()) {
    const processedContent = applySectionNumbering(
      content.trim(), 
      'content', 
      'none',
      numberingCounters
    );
    
    sections.push({
      id: 'content',
      title: 'Content',
      content: processedContent,
      icon: 'file-text',
      color: '-500/20 -500/20 border-gray-500/30',
      order: 1,
      isComplete: validateSectionCompletion(processedContent, 'content'),
      estimatedHeight: estimateContentHeight(processedContent),
      index: sections.length
    });
  }

  // ENFORCE: Ensure all required sections are present
  const requiredSections = ['title', 'goal', 'principles', 'operations', 'steps', 'final_output'];
  const existingSectionIds = new Set(sections.map(s => s.id));
  
  for (const requiredId of requiredSections) {
    if (!existingSectionIds.has(requiredId)) {
      const config = sectionConfigs.find(c => c.id === requiredId);
      if (config) {
        // Add placeholder section
        sections.push({
          id: requiredId,
          title: config.title,
          content: `_${config.title} section not found in recipe_`,
          icon: config.icon,
          color: config.color,
          order: config.order,
          isComplete: false,
          estimatedHeight: 100,
          index: sections.length
        });
      }
    }
  }

  const optionalSections = ['ui_automation'];
  for (const optionalId of optionalSections) {
    if (!existingSectionIds.has(optionalId)) {
      const config = sectionConfigs.find(c => c.id === optionalId);
      if (config) {
        sections.push({
          id: optionalId,
          title: config.title,
          content: `_No ${config.title.toLowerCase()} instructions provided in this recipe_`,
          icon: config.icon,
          color: config.color,
          order: config.order,
          isComplete: false,
          estimatedHeight: 120,
          index: sections.length
        });
      }
    }
  }

  return {
    sections: sections.sort((a, b) => a.order - b.order),
    executionTrace: executionTraceString,
    metadata: {
      totalSections: sections.length,
      estimatedTotalHeight: sections.reduce((sum, section) => sum + section.estimatedHeight, 0),
      hasStructuredContent
    }
  };
}

/**
 * Extract a clean, display‑ready title from recipe markdown.
 * - Prefers explicit Title section or first H1/H2/H3
 * - Strips markdown (** _ #), label prefixes ("Title:", "Recipe:"), quotes
 * - Collapses whitespace and trims to maxLen
 * - Handles multi-line format where title content is on the next line
 */
export function extractCleanTitle(content: string, maxLen: number = 120): string {
  if (!content) return '';

  const lines = content.split('\n');
  
  // Patterns that match title LABEL (may have content on same line or next line)
  const titleLabelPatterns: RegExp[] = [
    /^\*\*Title\*\*:?[ \t]*(.*)$/i,
    /^Title:?[ \t]*(.*)$/i,
    /^##\s+Title:?[ \t]*(.*)$/i,
    /^###\s+Title:?[ \t]*(.*)$/i,
  ];
  
  // Patterns that ARE the title content directly
  const titleContentPatterns: RegExp[] = [
    /^#\s+(.+)$/,           // H1 header
    /^##\s+(?!Title)(.+)$/i, // H2 header (not "Title")
    /^###\s+(?!Title)(.+)$/i, // H3 header (not "Title")
    /^\*\*Algorithmic Recipe for (.+)\*\*$/i,
    /^Algorithmic Recipe for (.+)$/i
  ];

  let raw = '';
  
  // First, check for title label patterns that may need next-line lookup
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || '';
    
    for (const pattern of titleLabelPatterns) {
      const match = pattern.exec(line);
      if (match) {
        // Check if we captured content on the same line
        const capturedContent = (match[1] || '').trim();
        
        if (capturedContent && capturedContent.length > 0 && 
            capturedContent.toLowerCase() !== 'title' &&
            !capturedContent.startsWith('**')) {
          raw = capturedContent;
          break;
        }
        
        // No content on same line - look at next non-empty line
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const nextLine = (lines[j] || '').trim();
          // Skip empty lines and lines that look like section headers
          if (nextLine && 
              !nextLine.startsWith('**') && 
              !nextLine.startsWith('#') &&
              !nextLine.toLowerCase().startsWith('goal') &&
              !nextLine.toLowerCase().startsWith('principle')) {
            raw = nextLine;
            break;
          }
        }
        
        if (raw) break;
      }
    }
    if (raw) break;
  }
  
  // If no title from label patterns, try content patterns
  if (!raw) {
    for (const pattern of titleContentPatterns) {
      const match = pattern.exec(content);
      if (match && match[1]) { 
        raw = match[1]; 
        break; 
      }
    }
  }
  
  // Fallback: first non-empty line that isn't a section header
  if (!raw) {
    const first = lines.find(l => {
      const trimmed = l.trim();
      return trimmed.length > 0 && 
             !trimmed.match(/^\*\*(Title|Goal|Principles?|Operations?|Steps?)\*\*/i) &&
             !trimmed.match(/^(Title|Goal|Principles?|Operations?|Steps?):?$/i);
    });
    raw = first?.trim() || '';
  }

  let clean = raw
    .replace(/^\*+|\*+$/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^\[+|\]+$/g, '')  // Remove brackets
    .replace(/^(Recipe|Title)\s*:?\s*/i, '')
    .replace(/^#+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Safety check: if we ended up with just "Title" or empty, return empty
  if (clean.toLowerCase() === 'title' || clean.length < 3) {
    return '';
  }

  if (clean.length > maxLen) clean = clean.slice(0, maxLen - 1).trim() + '…';
  return clean;
}

/**
 * Legacy function to maintain backward compatibility
 * Parses recipe content into a structured format for visualization
 */
export function parseRecipeStructure(content: string): RecipeStructure {
  if (!content || !content.trim()) {
    return {
      title: '',
      goal: '',
      principle: '',
      operations: []
    };
  }

  // Extract title (first heading or first paragraph)
  let title = '';
  const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^(.+)$/m);
  if (titleMatch) {
    title = removeMarkdownHeaders(titleMatch![1]!.trim());
  }

  // Extract goal section
  let goal = '';
  const goalMatch = content.match(/(?:^|\n)##?\s*(?:goal|objective|purpose|aim)s?[:\s]*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (goalMatch) {
    goal = goalMatch![1]!.trim();
  }

  // Extract principle section
  let principle = '';
  const principleMatch = content.match(/(?:^|\n)##?\s*(?:principle|rule|guideline|foundation)s?[:\s]*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (principleMatch) {
    principle = principleMatch![1]!.trim();
  }

  // Extract operations and steps
  const operations: RecipeOperation[] = [];
  
  // Try to find operations section
  const operationsMatch = content.match(/(?:^|\n)##?\s*(?:operation|action|method|process|procedure)s?[:\s]*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (operationsMatch) {
    // Parse operations
    const operationLines = operationsMatch![1]!.split('\n');
    let currentOperation: RecipeOperation | null = null;
    
    for (const line of operationLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // Check if this is an operation title (starts with number or bullet)
      const operationTitleMatch = trimmedLine.match(/^(?:\d+\.|\*|-)\s+(.+)$/);
      if (operationTitleMatch) {
        if (currentOperation) {
          operations.push(currentOperation);
        }
        currentOperation = {
          title: removeMarkdownHeaders(operationTitleMatch![1]!.trim()),
          steps: []
        };
      } else if (currentOperation) {
        // Add as description to current operation
        currentOperation.title += ' ' + trimmedLine;
      }
    }
    
    // Add the last operation
    if (currentOperation) {
      operations.push(currentOperation);
    }
  }
  
  // Extract steps section
  const stepsMatch = content.match(/(?:^|\n)##?\s*(?:step|instruction|implementation|execution|procedure)s?[:\s]*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (stepsMatch) {
    // If no operations found, create a default one
    if (operations.length === 0) {
      operations.push({
        title: 'Main Process',
        steps: []
      });
    }
    
    // Parse steps
    const stepLines = stepsMatch![1]!.split('\n');
    let currentStep: RecipeStep | null = null;
    let stepNumber = 1;
    
    for (const line of stepLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // Check if this is a step (starts with number or bullet)
      const stepMatch = trimmedLine.match(/^(?:(\d+)\.|\*|-)\s+(.+)$/);
      if (stepMatch) {
        if (currentStep) {
          operations[0]?.steps.push(currentStep);
        }
        
        currentStep = {
          stepNumber: stepMatch[1] || stepNumber++,
          subSteps: [{
            text: removeMarkdownHeaders(stepMatch![2]!.trim())
          }]
        };
      } else if (currentStep) {
        // Check if this is a sub-step (indented)
        const subStepMatch = trimmedLine.match(/^\s+(?:[a-z]\.|\*|-)\s+(.+)$/);
        if (subStepMatch) {
          currentStep.subSteps.push({
            text: removeMarkdownHeaders(subStepMatch![1]!.trim())
          });
        } else {
          // Add to the last sub-step
          if (currentStep.subSteps.length > 0) {
            const lastSubStep = currentStep.subSteps[currentStep.subSteps.length - 1];
            if (lastSubStep) {
              lastSubStep.text += ' ' + trimmedLine;
            }
          }
        }
      }
    }
    
    // Add the last step
    if (currentStep && operations.length > 0 && operations[0]) {
      operations[0]?.steps.push(currentStep);
    }
  }

  // If no structured content found, try to extract from plain text
  if (!goal && operations.length === 0) {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    
    if (paragraphs.length >= 1) {
      // First paragraph as title if not already set
      if (!title && paragraphs[0]) {
        title = paragraphs[0].trim();
      }
      
      // Second paragraph as goal if available
      if (paragraphs.length >= 2 && paragraphs[1]) {
        goal = paragraphs[1].trim();
      }
      
      // Remaining paragraphs as steps
      if (paragraphs.length >= 3) {
        const defaultOperation: RecipeOperation = {
          title: 'Main Process',
          steps: []
        };
        
        paragraphs.slice(2).forEach((paragraph, index) => {
          defaultOperation.steps.push({
            stepNumber: index + 1,
            subSteps: [{
              text: paragraph.trim()
            }]
          });
        });
        
        operations.push(defaultOperation);
      }
    }
  }

  return {
    title,
    goal,
    principle,
    operations
  };
}



/**
 * Applies section-aware numbering based on the numbering scheme
 */
function applySectionNumbering(
  content: string, 
  sectionId: string, 
  scheme: string,
  _counters: { numeric: number; phase: number; bullet: number }
): string {
  if (scheme === 'none') return content;
  
  const lines = content.split('\n');
  const processedLines: string[] = [];
  
  // Create section-specific counter that always starts fresh
  let sectionCounter = 1;

  const isStepDetailLine = (value: string): boolean => {
    return /^(action|input|output|parameters?|result(?:\s+variable)?|tool|guard|op|causal\s+reasoning)\s*:/i.test(value);
  };

  const normalizeStepHeadline = (value: string): string => {
    return value
      .replace(/^step\s*\d+\s*[:.)-]?\s*/i, '')
      .replace(/^phase\s*\d+\s*[:.)-]?\s*/i, '')
      .trim();
  };
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) {
      processedLines.push(line);
      continue;
    }
    
    // Check if line needs numbering (starts with *, -, or is a numbered item)
    const needsNumbering = /^[*\-]\s+/.test(trimmedLine) || /^\d+\.\s+/.test(trimmedLine);
    
    if (needsNumbering) {
      const cleanContent = trimmedLine.replace(/^[*\-\d\.\s]+/, '').trim();

      // Steps must number only true step headers, not every line inside a step.
      if (scheme === 'numeric' && sectionId === 'steps') {
        const explicitStepMatch =
          /^(?:[*\-•]\s*)?(?:step|phase)\s*\d+\s*[:.)-]?\s*(.+)$/i.exec(trimmedLine);
        const numberedItemMatch = /^\d+[.)]\s+(.+)$/.exec(trimmedLine);

        const candidate = explicitStepMatch?.[1] || numberedItemMatch?.[1] || cleanContent;
        const normalizedCandidate = normalizeStepHeadline(candidate);

        if (normalizedCandidate && !isStepDetailLine(normalizedCandidate)) {
          processedLines.push(`${sectionCounter}. ${normalizedCandidate}`);
          sectionCounter++;
        } else {
          processedLines.push(line);
        }
        continue;
      }
      
      switch (scheme) {
        case 'numeric':
          processedLines.push(`${sectionCounter}. ${cleanContent}`);
          sectionCounter++;
          break;
        case 'phase':
          processedLines.push(`**Phase ${sectionCounter}**: ${cleanContent}`);
          sectionCounter++;
          break;
        case 'bullet':
          processedLines.push(`• ${cleanContent}`);
          break;
        default:
          processedLines.push(line);
      }
    } else {
      processedLines.push(line);
    }
  }
  
  return processedLines.join('\n');
}

/**
 * Validates if a section has sufficient content to be considered complete
 */
function validateSectionCompletion(content: string, sectionId: string): boolean {
  const trimmedContent = content.trim();
  
  // Minimum content length requirements by section type
  const minLengths = {
    title: 5,
    goal: 20,
    principles: 50,
    operations: 100,
    steps: 150,
    ui_automation: 40,
    content: 20
  };
  
  const minLength = minLengths[sectionId as keyof typeof minLengths] || 20;
  
  // Check minimum length
  if (trimmedContent.length < minLength) return false;
  
  // Check for structured content in list-based sections
  if (['principles', 'operations', 'steps'].includes(sectionId)) {
    const hasListItems = /[*\-•]\s+|\d+\.\s+/.test(trimmedContent);
    if (!hasListItems) return false;
  }

  if (sectionId === 'ui_automation') {
    const hasActions = /<action\s+/i.test(trimmedContent);
    if (!hasActions) return false;
  }
  
  return true;
}

/**
 * Estimate content height for virtualization
 */
function estimateContentHeight(content: string): number {
  const baseHeight = 100; // Base section height
  const lineHeight = 24; // Approximate line height
  const lines = content.split('\n').length;
  const codeBlocks = (content.match(/```/g) || []).length / 2;
  const lists = (content.match(/^[\s]*[-*+]\s/gm) || []).length;
  
  return baseHeight + (lines * lineHeight) + (codeBlocks * 100) + (lists * 10);
}

/**
 * Get section by ID with fallback
 */
export function getSectionById(sections: RecipeSection[], id: string): RecipeSection | null {
  return sections.find(section => section.id === id) || null;
}

/**
 * Update section completion status
 */
export function updateSectionCompletion(
  sections: RecipeSection[], 
  sectionId: string, 
  isComplete: boolean
): RecipeSection[] {
  return sections.map(section => 
    section.id === sectionId 
      ? { ...section, isComplete }
      : section
  );
}

/**
 * Get the currently streaming section (last incomplete section)
 */
export function getCurrentStreamingSection(sections: RecipeSection[]): RecipeSection | null {
  const incompleteSections = sections.filter(section => !section.isComplete);
  return incompleteSections.length > 0 ? (incompleteSections[0] || null) : null;
}

/**
 * Detects streaming completion based on content analysis
 */
export function detectStreamingCompletion(content: string, previousContent: string): boolean {
  // Check if content has stopped growing
  if (content.length === previousContent.length) return true;
  
  // Check for completion markers
  const completionMarkers = [
    /\n\n$/,  // Ends with double newline
    /[.!?]\s*$/,  // Ends with sentence punctuation
    /\*\*Output\*\*:/i,  // Contains output marker
    /\*\*Result\*\*:/i   // Contains result marker
  ];
  
  return completionMarkers.some(marker => marker.test(content));
}

/**
 * Enhanced streaming completion detection
 */
export function detectStreamingCompletionEnhanced(content: string): boolean {
  const lines = content.split('\n');
  const lastLine = lines[lines.length - 1]?.trim();
  
  // Check for common completion indicators
  const completionIndicators = [
    /^\*\*Output\*\*:/,
    /^\*\*Result\*\*:/,
    /^\*\*Conclusion\*\*:/,
    /Project completion status/i,
    /final deliverables/i
  ];
  
  return completionIndicators.some(pattern => pattern.test(lastLine || ''));
}

/**
 * Creates section-aware streaming cursor position
 */
export function getStreamingCursorPosition(content: string, sections: RecipeSection[]): {
  sectionId: string;
  position: number;
  context: string;
} {
  const currentSection = getCurrentStreamingSection(sections);
  
  // Analyze content to determine current section being written
  const lines = content.split('\n');
  const lastNonEmptyLine = lines.filter(line => line.trim()).pop() || '';
  
  // Dynamic context based on content analysis
  if (lastNonEmptyLine.toLowerCase().includes('title') || content.match(/^#\s/m)) {
    return {
      sectionId: 'title',
      position: content.length,
      context: 'Crafting title...'
    };
  }
  
  if (lastNonEmptyLine.toLowerCase().includes('goal') || content.toLowerCase().includes('goal:')) {
    return {
      sectionId: 'goal',
      position: content.length,
      context: 'Defining objectives...'
    };
  }
  
  if (lastNonEmptyLine.toLowerCase().includes('principle') || content.toLowerCase().includes('principle')) {
    return {
      sectionId: 'principles',
      position: content.length,
      context: 'Establishing principles...'
    };
  }
  
  if (lastNonEmptyLine.toLowerCase().includes('operation') || content.toLowerCase().includes('operation')) {
    return {
      sectionId: 'operations',
      position: content.length,
      context: 'Outlining operations...'
    };
  }
  
  if (lastNonEmptyLine.toLowerCase().includes('step') || content.toLowerCase().includes('step')) {
    return {
      sectionId: 'steps',
      position: content.length,
      context: 'Building step-by-step guide...'
    };
  }
  
  // Fallback to current section if detected
  if (currentSection) {
    const contextMessages = {
      title: 'Crafting title...',
      goal: 'Defining objectives...',
      principles: 'Establishing principles...',
      operations: 'Outlining operations...',
      steps: 'Building step-by-step guide...',
      content: 'Generating content...'
    };
    
    return {
      sectionId: currentSection!.id,
      position: content.length,
      context: contextMessages[currentSection!.id as keyof typeof contextMessages] || 'Creating content...'
    };
  }
  
  // Smart fallback based on content length and structure
  if (content.length < 50) {
    return {
      sectionId: 'initialization',
      position: content.length,
      context: 'Initializing response...'
    };
  }
  
  return {
    sectionId: 'content',
    position: content.length,
    context: 'Finalizing content...'
  };
}

/**
 * Enhanced streaming cursor position detection
 */
export function getStreamingCursorPositionEnhanced(content: string): { line: number; section: string | null } {
  const lines = content.split('\n');
  const currentLine = lines.length;
  
  // Find the current section based on cursor position
  let currentSection: string | null = null;
  
  const sectionConfigs = [
    { 
      id: 'title', 
      patterns: [
        /^#\s+(.+)$/,
        /^\*\*Title\*\*:?\s*(.*)$/i,
        /^Title:?\s*(.*)$/i
      ]
    },
    { 
      id: 'goal', 
      patterns: [
        /^##\s+(goal|objective|purpose|aim)s?$/i,
        /^\*\*(goal|objective|purpose|aim)s?\*\*:?\s*$/i,
        /^(goal|objective|purpose|aim)s?:?\s*$/i
      ]
    },
    { 
      id: 'principles', 
      patterns: [
        /^##\s+(principles?|rules?|guidelines?|foundations?)$/i,
        /^\*\*(principles?|rules?|guidelines?|foundations?)\*\*:?\s*$/i,
        /^(principles?|rules?|guidelines?|foundations?):?\s*$/i
      ]
    },
    { 
      id: 'operations', 
      patterns: [
        /^##\s+(operation|action|method|process|procedure)s?$/i,
        /^\*\*(operation|action|method|process|procedure)s?\*\*:?\s*$/i,
        /^(operation|action|method|process|procedure)s?:?\s*$/i
      ]
    },
    { 
      id: 'steps', 
      patterns: [
        /^##\s+(step|instruction|implementation|execution|procedure)s?$/i,
        /^\*\*(step|instruction|implementation|execution|procedure)s?\*\*:?\s*$/i,
        /^(step|instruction|implementation|execution|procedure)s?:?\s*$/i
      ]
    }
  ];
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] || '').trim();
    
    for (const config of sectionConfigs) {
      if (config.patterns.some(pattern => pattern.test(line))) {
        currentSection = config.id;
        break;
      }
    }
    
    if (currentSection) break;
  }
  
  return { line: currentLine, section: currentSection };
}
