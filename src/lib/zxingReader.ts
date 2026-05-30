import { readBarcodes, setZXingModuleOverrides } from 'zxing-wasm/reader'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

// Decode 1-D part-label barcodes directly with the WASM ZXing engine, at the
// camera's FULL sensor resolution. html5-qrcode hands its own decoder a
// canvas scaled to the *display* size (~300px on a phone), which blurs thin
// Code 128 / Code 39 bars into mush — so we run this pass on the full-res
// frame in parallel (see QrScannerModal). tryHarder/Rotate/Invert are on for
// the best catch rate on slightly skewed / glare-y labels.

// Load the WASM from our own bundle (Vite-hashed) — no runtime CDN dependency.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path,
})

export async function decodeBarcodeFromImageData(
  image: ImageData,
): Promise<string | null> {
  const results = await readBarcodes(image, {
    formats: [
      'Code128',
      'Code39',
      'Code93',
      'Codabar',
      'ITF',
      'EAN-13',
      'EAN-8',
      'UPC-A',
      'UPC-E',
    ],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 1,
  })
  const hit = results.find((r) => r.text && r.text.trim().length > 0)
  return hit ? hit.text.trim() : null
}
