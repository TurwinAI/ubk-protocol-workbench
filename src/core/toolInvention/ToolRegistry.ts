/**
 * Tool Registry for Dynamic Tool Management
 * Manages the lifecycle of custom tools defined at runtime
 */

import { JSONSchema7 } from 'json-schema';
import Ajv from 'ajv';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: JSONSchema7;
  callback: ToolCallback;
  createdAt: string;
  version: string;
  metadata?: Record<string, any>;
}

export interface ToolCallback {
  execute(params: Record<string, any>, context: ExecutionContext): Promise<any>;
}

export interface ExecutionContext {
  variables: Map<string, any>;
  state: string;
  tape: (0 | 1)[];
  headPosition: number;
  stepCount: number;
  maxSteps: number;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private ajv: Ajv;
  private readonly maxTools: number = 100;
  
  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    this.registerBuiltinTools();
  }
  
  /**
   * Register a new tool definition
   */
  registerTool(definition: ToolDefinition): void {
    if (this.tools.size >= this.maxTools) {
      throw new Error(`Maximum number of tools (${this.maxTools}) exceeded`);
    }
    
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' already exists`);
    }
    
    // Validate schema
    try {
      this.ajv.compile(definition.schema as any);
    } catch (error: any) {
      throw new Error(`Invalid schema for tool '${definition.name}': ${error.message}`);
    }
    
    // Add metadata
    definition.createdAt = new Date().toISOString();
    definition.version = '1.0.0';
    
    this.tools.set(definition.name, definition);
  }
  
  /**
   * Get a tool definition by name
   */
  getTool(name: string): ToolDefinition | null {
    return this.tools.get(name) || null;
  }
  
  /**
   * Validate tool call parameters against schema
   */
  validateToolCall(name: string, params: Record<string, any>): boolean {
    const tool = this.tools.get(name);
    if (!tool) {
      return false;
    }
    
    const validate = this.ajv.compile(tool.schema as any);
    return validate(params) as boolean;
  }
  
  /**
   * Get validation errors for tool call
   */
  getValidationErrors(name: string, params: Record<string, any>): string[] {
    const tool = this.tools.get(name);
    if (!tool) {
      return [`Tool '${name}' not found`];
    }
    
    const validate = this.ajv.compile(tool.schema as any);
    validate(params);
    
    return validate.errors?.map(error => 
      `${error.instancePath} ${error.message}`
    ) || [];
  }
  
  /**
   * List all registered tools
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
  
  /**
   * Remove a tool from registry
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }
  
  /**
   * Clear all custom tools (keep built-ins)
   */
  clearCustomTools(): void {
    const builtinNames = ['http_fetch', 'html_parser', 'price_extractor', 'math_average'];
    for (const [name] of this.tools) {
      if (!builtinNames.includes(name)) {
        this.tools.delete(name);
      }
    }
  }
  
  /**
   * Execute a tool by name with arguments
   */
  async executeTool(name: string, args: any, context: ExecutionContext): Promise<{ output: any }> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    // Validate arguments
    const validationErrors = this.getValidationErrors(name, args);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid arguments for tool '${name}': ${validationErrors.join(', ')}`);
    }

    try {
      const output = await tool.callback.execute(args, context);
      return { output };
    } catch (error) {
      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Convert tools to Gemini Function Declarations
   */
  toGeminiTools(toolNames?: string[]): any[] {
    const toolsToExport = toolNames 
      ? toolNames.map(name => this.tools.get(name)).filter(t => t !== undefined) as ToolDefinition[]
      : Array.from(this.tools.values());

    return toolsToExport.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.schema.properties || {},
        required: tool.schema.required || []
      }
    }));
  }

  /**
   * Register built-in tools that are commonly used
   */
  private registerBuiltinTools(): void {
    // HTTP Fetch Tool
    this.tools.set('http_fetch', {
      name: 'http_fetch',
      description: 'Fetches content from a URL',
      schema: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          headers: { type: 'object' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
          timeout: { type: 'number', minimum: 1000, maximum: 30000 }
        },
        required: ['url']
      },
      callback: {
        async execute(params: any): Promise<string> {
          // Simulated HTTP fetch - in real implementation would use fetch API
          const { url, _headers: __headers = {}, method: _method = 'GET', timeout: _timeout = 10000 } = params;
          
          // Security check - only allow HTTPS and specific domains
          if (!url.startsWith('https://')) {
            throw new Error('Only HTTPS URLs are allowed');
          }
          
          // Simulate fetch delay
          await new Promise(resolve => setTimeout(resolve, 100));
          
          return `<html><body>Content from ${url}</body></html>`;
        }
      },
      createdAt: new Date().toISOString(),
      version: '1.0.0'
    });
    
    // HTML Parser Tool
    this.tools.set('html_parser', {
      name: 'html_parser',
      description: 'Extracts elements from HTML using CSS selectors',
      schema: {
        type: 'object',
        properties: {
          html: { type: 'string' },
          selector: { type: 'string' },
          attribute: { type: 'string' }
        },
        required: ['html', 'selector']
      },
      callback: {
        async execute(params: any): Promise<string[]> {
          const { _html: __html, selector, attribute: _attribute } = params;
          
          // Simulated HTML parsing - in real implementation would use cheerio or similar
          if (selector === '.price-display') {
            return ['$299.99', '$199.99', '$399.99'];
          }
          
          return [`Extracted content for selector: ${selector}`];
        }
      },
      createdAt: new Date().toISOString(),
      version: '1.0.0'
    });
    
    // Price Extractor Tool
    this.tools.set('price_extractor', {
      name: 'price_extractor',
      description: 'Extracts price from text using regex',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] }
        },
        required: ['text']
      },
      callback: {
        async execute(params: any): Promise<number> {
          const { text, currency: _currency = 'USD' } = params;
          
          // Extract numeric value from price text
          const priceMatch = text.match(/\$?([0-9,]+\.?[0-9]*)/); 
          if (priceMatch) {
            return parseFloat(priceMatch[1].replace(',', ''));
          }
          
          throw new Error(`Could not extract price from: ${text}`);
        }
      },
      createdAt: new Date().toISOString(),
      version: '1.0.0'
    });
    
    // Math Average Tool
    this.tools.set('math_average', {
      name: 'math_average',
      description: 'Calculates average of numeric values',
      schema: {
        type: 'object',
        properties: {
          values: {
            type: 'array',
            items: { type: 'number' },
            minItems: 1
          }
        },
        required: ['values']
      },
      callback: {
        async execute(params: any): Promise<number> {
          const { values } = params;
          
          if (!Array.isArray(values) || values.length === 0) {
            throw new Error('Values must be a non-empty array');
          }
          
          const sum = values.reduce((acc, val) => acc + val, 0);
          return sum / values.length;
        }
      },
      createdAt: new Date().toISOString(),
      version: '1.0.0'
    });
  }
}

export default ToolRegistry;