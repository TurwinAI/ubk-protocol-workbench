/**
 * Standalone BYOK Model Configuration
 *
 * Reads model preferences and API key strictly from Node environment variables
 * or explicit per-request overrides. No cloud-vendor SDKs or hidden key proxies.
 */

import { HarmCategory, HarmBlockThreshold } from '@google/genai';

export interface ModelConfig {
  apiKey: string;
  defaultModel: string;
  fastModel: string;
  proModel: string;
  visionModel: string;
  titleModel: string;
  computerUseModel: string;
  simulationModel: string;
  imageGenModel: string;
}

export const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

let runtimeApiKeyOverride: string | undefined;

export function setRuntimeGeminiApiKey(apiKey: string | undefined): void {
  runtimeApiKeyOverride = apiKey?.trim() || undefined;
}

const getEnv = (key: string, fallback = ''): string => {
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key]!.trim() || fallback;
  }
  return fallback;
};

export const getModelConfigSync = (explicitApiKey?: string): ModelConfig => {
  const apiKey =
    explicitApiKey?.trim() ||
    runtimeApiKeyOverride ||
    getEnv('GEMINI_API_KEY') ||
    getEnv('GOOGLE_AI_API_KEY');

  const defaultModel = getEnv('GEMINI_MODEL', 'gemini-2.5-flash');
  const fastModel = getEnv('GEMINI_FAST_MODEL', defaultModel);
  const proModel = getEnv('GEMINI_PRO_MODEL', defaultModel);

  return {
    apiKey,
    defaultModel,
    fastModel,
    proModel,
    visionModel: getEnv('GEMINI_VISION_MODEL', defaultModel),
    titleModel: fastModel,
    computerUseModel: defaultModel,
    simulationModel: defaultModel,
    imageGenModel: getEnv('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),
  };
};

export const getModelConfig = async (explicitApiKey?: string): Promise<ModelConfig> => {
  return getModelConfigSync(explicitApiKey);
};
