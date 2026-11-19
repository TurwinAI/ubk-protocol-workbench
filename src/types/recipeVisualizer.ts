// src/types/recipeVisualizer.ts

export interface RecipeSubStep {
  text: string;
  // Add other sub-step specific properties if needed later
  // e.g., isComplete?: boolean;
}

export interface RecipeStep {
  stepNumber: number | string; // Can be numeric or like 'a', 'b'
  operationName?: string; // Optional operation name associated with the step
  principle?: string; // Optional principle associated with the step
  subSteps: RecipeSubStep[];
  // Add other step specific properties if needed later
  // e.g., isComplete?: boolean; isExpanded?: boolean;
}

export interface RecipeOperation {
  title: string;
  steps: RecipeStep[];
  // Add other operation specific properties if needed later
  // e.g., isExpanded?: boolean;
}

export interface RecipeStructure {
  title: string;
  goal: string;
  principle: string; // Overall principle
  operations: RecipeOperation[];
}

// Props for the main visualizer component
export interface RecipeVisualizerProps {
  recipe: RecipeStructure;
}

// Props for sub-components (can be expanded later)
export interface RecipeHeaderProps {
  title: string;
  goal: string;
}

export interface PrincipleDisplayProps {
  principle: string;
}

export interface OperationBlockProps {
  operation: RecipeOperation;
  // Add state/handlers later, e.g., onToggleExpand: () => void; isExpanded: boolean;
}

export interface StepItemProps {
  step: RecipeStep;
  // Add state/handlers later
}

export interface SubStepItemProps {
  subStep: RecipeSubStep;
  // Add state/handlers later
}
