/**
 * Pluggable embedding provider interface.
 *
 * Mirrors the IEmbeddingProvider from @gamma/openclaw-knowledge
 * so that the smart-chunker can remain decoupled from the skill package.
 */

export interface IEmbeddingProvider {
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<Float32Array>;
  /** Dimensionality of vectors produced by this provider. */
  readonly dimensions: number;
}
