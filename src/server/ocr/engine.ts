/**
 * The OCR engine boundary. Everything above this file works on text; only this file knows what turned a picture into
 * text. Tesseract.js runs SERVER-SIDE in a Node worker thread: the receipt never leaves Mellocrush, no third party is
 * called, and the wasm core plus the English model ship inside the deployment (docs/DEPLOYMENT.md §7). Swapping the
 * engine means one new `OcrEngine`; the parsers and their tests do not change.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface OcrReading {
  text: string;
  /** Whole-document confidence 0–100 when the engine reports one. */
  confidence: number | null;
}

export interface OcrEngine {
  /** For logs, tests and the stored `engine` column. Never shown to a customer. */
  readonly name: string;
  /** Picture in, text out. Throws only when the engine itself is broken or times out. */
  recognize(image: Uint8Array): Promise<OcrReading>;
}

export class OcrEngineError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OcrEngineError";
  }
}

export const OCR_RULES = {
  /** Hard stop for one recognition, worker start-up included. Well inside the route's maxDuration. */
  timeoutMs: 25_000,
  languageDataVersion: "4.0.0_best_int",
} as const;

const TESSERACT_VERSION = "7.0.0";

/**
 * The English model directory. Resolved from the project root first (which is how the traced files land on Vercel,
 * see next.config.ts outputFileTracingIncludes), then through Node resolution for other layouts.
 */
export function resolveLanguagePath(): string {
  const rel = path.join("node_modules", "@tesseract.js-data", "eng", OCR_RULES.languageDataVersion);
  const fromCwd = path.join(process.cwd(), rel);
  if (existsSync(path.join(fromCwd, "eng.traineddata.gz"))) return fromCwd;
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const pkg = require.resolve("@tesseract.js-data/eng/package.json");
  return path.join(path.dirname(pkg), OCR_RULES.languageDataVersion);
}

type TesseractModule = typeof import("tesseract.js");

export function tesseractEngine(): OcrEngine {
  return {
    name: `tesseract.js-${TESSERACT_VERSION}/eng-${OCR_RULES.languageDataVersion}`,
    async recognize(image) {
      const started = Date.now();
      const tesseract: TesseractModule = await import("tesseract.js");
      const { createWorker, OEM, PSM } = tesseract;
      let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrEngineError(`OCR timed out after ${OCR_RULES.timeoutMs} ms`)), OCR_RULES.timeoutMs);
      });
      try {
        const run = (async () => {
          worker = await createWorker("eng", OEM.LSTM_ONLY, {
            langPath: resolveLanguagePath(),
            cacheMethod: "none",
            gzip: true,
            logger: () => {},
            errorHandler: () => {},
          });
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
          const result = await worker.recognize(Buffer.from(image));
          const confidence = typeof result.data.confidence === "number" && Number.isFinite(result.data.confidence) ? Math.round(result.data.confidence) : null;
          return { text: result.data.text ?? "", confidence };
        })();
        return await Promise.race([run, timeout]);
      } catch (e) {
        if (e instanceof OcrEngineError) throw e;
        throw new OcrEngineError(`OCR engine failed after ${Date.now() - started} ms`, e);
      } finally {
        if (timer) clearTimeout(timer);
        // A worker left running holds its wasm heap for the life of the process.
        if (worker) await (worker as Awaited<ReturnType<typeof createWorker>>).terminate().catch(() => undefined);
      }
    },
  };
}

let engine: OcrEngine | undefined;

/** The engine in use. Tests replace it with a text-returning stub. */
export function getOcrEngine(): OcrEngine {
  if (!engine) engine = tesseractEngine();
  return engine;
}

export function setOcrEngine(next: OcrEngine | undefined): void {
  engine = next;
}

/** A stub engine for tests and fixtures: always returns the given text. */
export function textEngine(text: string, confidence: number | null = 90, name = "stub"): OcrEngine {
  return { name, recognize: async () => ({ text, confidence }) };
}

/** A stub engine that fails, for the graceful-degradation path. */
export function brokenEngine(message = "engine unavailable"): OcrEngine {
  return {
    name: "broken",
    recognize: async () => {
      throw new OcrEngineError(message);
    },
  };
}
