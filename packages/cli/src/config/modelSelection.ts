/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_GEMINI_MODEL,
  type GeminiClient,
} from '@google/gemini-cli-core';
import { withTimeout } from '../utils/withTimeout.js';

interface ApiError {
  status?: number;
  code?: number;
  response?: { status?: number };
  message?: string;
}

async function checkModelExists(
  geminiClient: GeminiClient,
  modelName: string,
  timeoutMs = 800,
): Promise<{ exists: boolean; reason?: string }> {
  try {
    // We don't have a dedicated "models.get" endpoint in the client.
    // Instead we send a minimal countTokens() request with an empty part as a
    // lightweight probe:
    //   - If the model exists and is accessible, the call succeeds quickly.
    //   - If the model is unknown, retired or forbidden, we get a 404/403/401.
    //   - If the backend is down or quota exhausted, we see 5xx/429/timeout.
    // This way we can distinguish between "model definitely not available"
    // and "could not verify right now" without doing a full generate() call.
    await withTimeout(
      geminiClient.getContentGenerator().countTokens({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: '' }] }],
      }),
      timeoutMs,
    );
    return { exists: true };
  } catch (err: unknown) {
    const error = err as ApiError;
    const status = error?.status ?? error?.code ?? error?.response?.status;

    if (status === 404) return { exists: false, reason: 'unknown' };
    if (status === 403) return { exists: false, reason: 'forbidden' };
    if (status === 401) return { exists: false, reason: 'unauthorized' };
    if (status === 400) return { exists: false, reason: 'invalid' };
    if (status === 429) return { exists: false, reason: 'rate_limited' };
    if (status && status >= 500)
      return { exists: false, reason: 'server_error' };

    if (error?.message === 'timeout')
      return { exists: false, reason: 'timeout' };

    return { exists: false, reason: 'error' };
  }
}

export async function verifyModel(
  argvModel: string | undefined,
  settingsModel: string | undefined,
  envModel: string | undefined,
  geminiClient: GeminiClient,
  defaultModel: string = DEFAULT_GEMINI_MODEL,
): Promise<{ model: string; logs: string[] }> {
  const logs: string[] = [];

  if (argvModel) {
    const result = await checkModelExists(geminiClient, argvModel);
    if (result.exists === true) return { model: argvModel, logs };
    logs.push(`Model "${argvModel}" not found. Check your model name.`);
  }

  if (settingsModel) {
    const result = await checkModelExists(geminiClient, settingsModel);
    if (result.exists === true) return { model: settingsModel, logs };
    logs.push(`Model "${settingsModel}" not found. Check your settings.json.`);
  }

  if (envModel) {
    const result = await checkModelExists(geminiClient, envModel);
    if (result.exists === true) return { model: envModel, logs };
    logs.push(
      `Model "${envModel}" not found. Check your environment variable.`,
    );
  }

  logs.push(`No model found. Falling back to default model "${defaultModel}"`);
  return { model: defaultModel, logs };
}
