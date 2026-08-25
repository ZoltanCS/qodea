import { InvalidArgsError } from './types.js';
import type { Tool } from './types.js';

export interface ImageGenConfig {
  baseUrl: string;
  apiKey: string;
  models?: string[];
}

/**
 * Image generation via the Azure OpenAI v1 images API.
 * Tries gpt-image-1 first, then dall-e-3. Returns a data-URI.
 */
export function createGenerateImageTool(cfg: ImageGenConfig): Tool {
  const models = cfg.models?.length ? cfg.models : ['gpt-image-1', 'dall-e-3'];

  return {
    name: 'generate_image',
    description: 'Generate an image from a text description. The image is shown to the user.',
    kind: 'read',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Vivid visual description of the image.' },
      },
      required: ['prompt'],
    },
    describe(args) {
      const p = String(args['prompt'] ?? '?');
      return `generate image: ${p.length > 60 ? `${p.slice(0, 60)}…` : p}`;
    },

    async run(rawArgs) {
      const prompt = rawArgs['prompt'];
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new InvalidArgsError('generate_image requires a "prompt" string');
      }
      const size = '1024x1024';
      const base = cfg.baseUrl.replace(/\/$/, '');

      let lastError: unknown;
      for (const model of models) {
        try {
          const res = await fetch(`${base}/images/generations`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${cfg.apiKey}`,
              'api-key': cfg.apiKey,
            },
            body: JSON.stringify({ model, prompt, size, n: 1 }),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);

          const json = JSON.parse(text) as {
            data?: Array<{ b64_json?: string; url?: string }>;
          };
          const first = json.data?.[0];
          if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
          if (first?.url) return first.url;
          throw new Error('no image payload in response');
        } catch (err) {
          lastError = err;
        }
      }
      throw new Error(
        `Image generation failed (tried: ${models.join(', ')}): ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    },
  };
}
