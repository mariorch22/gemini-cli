/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { verifyModel } from './modelSelection.js';
import {
  DEFAULT_GEMINI_MODEL,
  type GeminiClient,
} from '@google/gemini-cli-core';

// Mock interfaces for testing
interface MockError extends Error {
  status?: number;
}

// Mock client factory for different test scenarios
const createMockClient = (
  availableModels: Set<string>,
  errorType?: string,
) => ({
  getContentGenerator: () => ({
    countTokens: vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (availableModels.has(model)) {
        return Promise.resolve();
      }

      const error: MockError = new Error('Model not available');
      switch (errorType) {
        case 'forbidden':
          error.status = 403;
          break;
        case 'unauthorized':
          error.status = 401;
          break;
        case 'rate_limited':
          error.status = 429;
          break;
        case 'server_error':
          error.status = 500;
          break;
        case 'timeout':
          error.message = 'timeout';
          break;
        default:
          error.status = 404;
      }
      return Promise.reject(error);
    }),
  }),
});

describe('verifyModel', () => {
  describe('model precedence and validation', () => {
    it('should use CLI model when available', async () => {
      const client = createMockClient(new Set(['gemini-1.5-pro']));
      const result = await verifyModel(
        'gemini-1.5-pro',
        'gemini-2.5-pro',
        'gemini-1.5-flash',
        client as GeminiClient,
      );

      expect(result.model).toBe('gemini-1.5-pro');
      expect(result.logs).toEqual([]);
    });

    it('should fallback to settings model when CLI model unavailable', async () => {
      const client = createMockClient(new Set(['gemini-2.5-pro']));
      const result = await verifyModel(
        'invalid-model',
        'gemini-2.5-pro',
        'gemini-1.5-flash',
        client as GeminiClient,
      );

      expect(result.model).toBe('gemini-2.5-pro');
      expect(result.logs).toEqual([
        'Model "invalid-model" not found. Check your model name.',
      ]);
    });

    it('should fallback to env model when CLI and settings unavailable', async () => {
      const client = createMockClient(new Set(['gemini-1.5-flash']));
      const result = await verifyModel(
        'invalid-cli',
        'invalid-settings',
        'gemini-1.5-flash',
        client as GeminiClient,
      );

      expect(result.model).toBe('gemini-1.5-flash');
      expect(result.logs).toEqual([
        'Model "invalid-cli" not found. Check your model name.',
        'Model "invalid-settings" not found. Check your settings.json.',
      ]);
    });

    it('should use default model when all models unavailable', async () => {
      const client = createMockClient(new Set());
      const result = await verifyModel(
        'invalid-cli',
        'invalid-settings',
        'invalid-env',
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toEqual([
        'Model "invalid-cli" not found. Check your model name.',
        'Model "invalid-settings" not found. Check your settings.json.',
        'Model "invalid-env" not found. Check your environment variable.',
        `No model found. Falling back to default model "${DEFAULT_GEMINI_MODEL}"`,
      ]);
    });

    it('should use custom default model', async () => {
      const customDefault = 'custom-default-model';
      const client = createMockClient(new Set());
      const result = await verifyModel(
        undefined,
        undefined,
        undefined,
        client as GeminiClient,
        customDefault,
      );

      expect(result.model).toBe(customDefault);
      expect(result.logs).toEqual([
        `No model found. Falling back to default model "${customDefault}"`,
      ]);
    });
  });

  describe('error handling scenarios', () => {
    it('should handle 403 forbidden errors', async () => {
      const client = createMockClient(new Set(), 'forbidden');
      const result = await verifyModel(
        'test-model',
        undefined,
        undefined,
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toContain(
        'Model "test-model" not found. Check your model name.',
      );
    });

    it('should handle 401 unauthorized errors', async () => {
      const client = createMockClient(new Set(), 'unauthorized');
      const result = await verifyModel(
        'test-model',
        undefined,
        undefined,
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toContain(
        'Model "test-model" not found. Check your model name.',
      );
    });

    it('should handle timeout errors', async () => {
      const client = createMockClient(new Set(), 'timeout');
      const result = await verifyModel(
        'test-model',
        undefined,
        undefined,
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toContain(
        'Model "test-model" not found. Check your model name.',
      );
    });

    it('should handle server errors', async () => {
      const client = createMockClient(new Set(), 'server_error');
      const result = await verifyModel(
        'test-model',
        undefined,
        undefined,
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toContain(
        'Model "test-model" not found. Check your model name.',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty parameters gracefully', async () => {
      const client = createMockClient(new Set());
      const result = await verifyModel(
        undefined,
        undefined,
        undefined,
        client as GeminiClient,
      );

      expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(result.logs).toEqual([
        `No model found. Falling back to default model "${DEFAULT_GEMINI_MODEL}"`,
      ]);
    });

    it('should not call API when no models to verify', async () => {
      const mockCountTokens = vi.fn();
      const client = {
        getContentGenerator: () => ({ countTokens: mockCountTokens }),
      };

      await verifyModel(
        undefined,
        undefined,
        undefined,
        client as GeminiClient,
      );
      expect(mockCountTokens).not.toHaveBeenCalled();
    });

    it('should stop checking after first valid model', async () => {
      const mockCountTokens = vi
        .fn()
        .mockResolvedValueOnce(undefined) // CLI model succeeds
        .mockRejectedValue({ status: 404 }); // Should not be called

      const client = {
        getContentGenerator: () => ({ countTokens: mockCountTokens }),
      };

      const result = await verifyModel(
        'valid-cli-model',
        'settings-model',
        'env-model',
        client as GeminiClient,
      );

      expect(result.model).toBe('valid-cli-model');
      expect(mockCountTokens).toHaveBeenCalledTimes(1);
    });
  });
});
