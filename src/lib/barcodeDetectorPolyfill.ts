/**
 * Polyfill the browser `BarcodeDetector` API with a WASM-backed ZXing engine
 * on browsers that lack it natively (notably iOS Safari).
 *
 * Why this exists: html5-qrcode uses `window.BarcodeDetector` as its primary
 * decoder when present (we enable `useBarCodeDetectorIfSupported`). Without a
 * native one it falls back to a pure-JS ZXing build that's weak on dense 1-D
 * part-label barcodes (Code 128 / Code 39) — so many Proton labels wouldn't
 * decode at all on iPhone. The WASM engine here is far more accurate.
 *
 * Side-effect import: bringing this module in installs the polyfill. It only
 * overrides when there's NO native `BarcodeDetector`, so Android Chrome keeps
 * its native detector (faster and already accurate).
 */
import {
  BarcodeDetector as ZXingBarcodeDetector,
  setZXingModuleOverrides,
} from 'barcode-detector'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// Load the WASM from our own bundle (Vite hashes + serves it) rather than the
// library's default CDN, so scanning never depends on an external CDN at
// runtime — important for a workshop on flaky/locked-down networks.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path,
})

if (typeof window !== 'undefined' && !('BarcodeDetector' in window)) {
  ;(
    window as unknown as { BarcodeDetector: typeof ZXingBarcodeDetector }
  ).BarcodeDetector = ZXingBarcodeDetector
}
