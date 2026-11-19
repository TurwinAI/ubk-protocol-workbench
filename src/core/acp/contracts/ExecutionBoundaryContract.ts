export interface ExecutionBoundary {
  allowedTools: string[];
  maxTokens: number;
  maxBudgetUsd: number;
  restrictedDataCategories: string[];
  requiresHumanApproval: boolean;
  maxExecutionTimeMs: number;
}
