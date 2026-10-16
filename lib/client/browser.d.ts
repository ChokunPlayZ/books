interface BarcodeResult {
  text: string;
}

declare const ZXingWASM: {
  readBarcodes(
    image: ImageData,
    options: {
      formats: string[];
      tryHarder: boolean;
      tryRotate: boolean;
      tryInvert: boolean;
      minLineCount: number;
      maxNumberOfSymbols: number;
    },
  ): Promise<BarcodeResult[]>;
};

interface TextWorker {
  setParameters(options: { tessedit_pageseg_mode: number }): Promise<unknown>;
  recognize(canvas: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

declare const Tesseract: {
  PSM: { SPARSE_TEXT: number };
  createWorker(
    language: string,
    engine: number,
    options: {
      workerPath: string;
      corePath: string;
      langPath: string;
    },
  ): Promise<TextWorker>;
};

interface PhotoTask {
  worker: TextWorker | null;
  cancelled?: Promise<void>;
  cancel?: () => void;
}

interface Element {
  _book?: import("../types").StoredBook;
  _title?: { categories?: { url: string }[] };
  _catalogKey?: string;
  _feed?: unknown;
  _loading?: boolean;
  _editorVersion?: number;
}
