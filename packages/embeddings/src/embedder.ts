export const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";
export const DEFAULT_DIMENSION = 384;

export interface EmbedderLike {
  readonly model: string;
  readonly dimension: number;
  encode(text: string): Promise<Float32Array>;
}

interface FeatureExtractionPipeline {
  (text: string | string[], options: { pooling: "mean"; normalize: boolean }): Promise<{
    data: Float32Array | number[];
    dims: number[];
  }>;
}

let cachedPipeline: FeatureExtractionPipeline | null = null;
let cachedModel: string | null = null;

async function loadPipeline(model: string): Promise<FeatureExtractionPipeline> {
  if (cachedPipeline && cachedModel === model) return cachedPipeline;
  const { pipeline, env } = await import("@xenova/transformers");
  // Allow remote model download by default; users can pre-cache for offline use.
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  const pipe = (await pipeline("feature-extraction", model)) as unknown as FeatureExtractionPipeline;
  cachedPipeline = pipe;
  cachedModel = model;
  return pipe;
}

export class Embedder implements EmbedderLike {
  private constructor(
    private readonly pipe: FeatureExtractionPipeline,
    public readonly model: string,
    public readonly dimension: number,
  ) {}

  static async create(model: string = DEFAULT_MODEL): Promise<Embedder> {
    const pipe = await loadPipeline(model);
    const probe = await pipe("dimension probe", { pooling: "mean", normalize: true });
    const dim = probe.data instanceof Float32Array ? probe.data.length : probe.data.length;
    return new Embedder(pipe, model, dim);
  }

  async encode(text: string): Promise<Float32Array> {
    const result = await this.pipe(text, { pooling: "mean", normalize: true });
    return result.data instanceof Float32Array
      ? result.data
      : Float32Array.from(result.data);
  }

  async encodeMany(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const t of texts) {
      out.push(await this.encode(t));
    }
    return out;
  }
}

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
