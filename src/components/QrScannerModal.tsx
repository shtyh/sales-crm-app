import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
// Installs a WASM-backed BarcodeDetector on iOS Safari (no native one), which
// html5-qrcode then uses as its primary decoder — pure-JS ZXing couldn't read
// many dense Code 128 / Code 39 part labels. See the module for details.
import '../lib/barcodeDetectorPolyfill'
import { decodeBarcodeFromImageData } from '../lib/zxingReader'

// Modal wrapper around html5-qrcode's camera scanner. Lives in its own
// file so any page that wants a "scan this code" button can drop it in
// with one prop. We pick the **environment-facing** camera by default
// (the back camera on phones, the only camera on most workshop PCs).
//
// Behaviour:
//   - Opens with `open=true`. On mount it asks the browser for camera
//     access, then attaches the live preview into the inner div.
//   - On a successful decode → calls onScan(text) once and dismisses
//     itself. We dedupe rapid duplicate decodes within a 1s window so
//     the QR symbol staying in frame doesn't fire 30 callbacks/sec.
//   - On close (X / Escape / outside-click) the scanner is stopped
//     before unmount so the camera light goes off immediately.
//   - If the user denies camera access we surface a friendly message
//     with the fallback (paste / USB scanner instructions).

const SCANNER_ELEMENT_ID = 'qr-scanner-region'

export type ScannerMode = 'qr' | 'barcode'

// Narrow the format set per use case — feeding fewer candidate symbologies
// to the decoder both speeds it up and cuts false-positives. The DO scanner
// only needs 2D codes (QR + the other 2D families just in case); the part
// scanner only needs 1D linear codes.
const QR_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.PDF_417,
]

const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
]

export function QrScannerModal({
  open,
  title,
  mode = 'qr',
  onScan,
  onClose,
}: {
  open: boolean
  title: string
  mode?: ScannerMode
  onScan: (text: string) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastDecodeRef = useRef<{ text: string; at: number }>({
    text: '',
    at: 0,
  })
  // Keep the latest callbacks in refs so the start-effect can call into
  // them without listing them as deps — otherwise inline arrow props
  // (recreated on every parent render) would tear the scanner down +
  // re-start it on every keystroke in the parent form, racing with the
  // conditional error-UI render and surfacing "Element not found".
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onScanRef.current = onScan
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let scanner: Html5Qrcode | null = null
    let loopTimer: ReturnType<typeof setTimeout> | undefined
    setError(null)

    // Fire the scan result once, de-duped — shared by html5-qrcode's own
    // decoder and our full-resolution barcode pass below.
    function handleHit(decoded: string) {
      const now = Date.now()
      const last = lastDecodeRef.current
      if (last.text === decoded && now - last.at < 1500) return
      lastDecodeRef.current = { text: decoded, at: now }
      onScanRef.current(decoded)
      if (typeof navigator.vibrate === 'function') navigator.vibrate(60)
      onCloseRef.current()
    }

    async function start() {
      // Give React one frame to paint the scanner region <div> before
      // html5-qrcode calls document.getElementById on the id.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      if (cancelled) return
      if (!document.getElementById(SCANNER_ELEMENT_ID)) {
        setError('Could not initialise the scanner region. Close and retry.')
        return
      }

      try {
        scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          formatsToSupport:
            mode === 'barcode' ? BARCODE_FORMATS : QR_FORMATS,
          // Native BarcodeDetector API where available (Chrome on
          // Android, Safari iOS 17+) — orders of magnitude faster +
          // more accurate than the JS-side ZXing fallback, especially
          // on 1D linear barcodes. Falls through automatically on
          // older browsers.
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        })
        scannerRef.current = scanner

        await scanner.start(
          // First arg is required but ignored once `videoConstraints`
          // (below) is set — camera selection happens there instead.
          { facingMode: 'environment' },
          {
            fps: mode === 'barcode' ? 12 : 10,
            // No `qrbox`: its shaded-region overlay mis-renders when the
            // stream aspect doesn't match the square preview (it squashed
            // the QR box into a strip and the barcode band into a thin
            // line). We scan the whole frame and draw our own guide box
            // below, so what the operator aligns to matches what decodes.
            //
            // Ask for a high-res rear stream. The blur the operator hit is
            // a focus problem: filling the frame means holding the phone
            // closer than the lens can focus. A ~1280px capture keeps
            // enough detail to decode a barcode that fills only part of
            // the frame, so they can hold it at a sharp distance.
            videoConstraints: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            // 1D barcodes look the same flipped — skip the extra
            // mirror-image pass html5-qrcode does by default.
            disableFlip: mode === 'barcode',
          },
          (decoded) => handleHit(decoded),
          undefined,
        )
        // Best-effort: nudge the camera into continuous autofocus so a
        // barcode held at a readable distance stays sharp. Unsupported on
        // most iOS Safari builds — failures are swallowed, never fatal.
        try {
          const video = document.querySelector<HTMLVideoElement>(
            `#${SCANNER_ELEMENT_ID} video`,
          )
          const track = (
            video?.srcObject as MediaStream | null
          )?.getVideoTracks?.()[0]
          if (track) {
            await track
              .applyConstraints({
                advanced: [{ focusMode: 'continuous' }],
              } as unknown as MediaTrackConstraints)
              .catch(() => {})
          }
        } catch {
          /* focus tuning is best-effort */
        }

        // Full-resolution barcode pass (barcode mode only). html5-qrcode
        // decodes a canvas scaled to the on-screen preview size (~300px),
        // which blurs thin part-label bars; here we decode the camera's
        // native-res frame ourselves with WASM ZXing. Purely additive —
        // whichever path reads the code first wins (handleHit de-dupes).
        if (mode === 'barcode' && !cancelled) {
          const liveVideo = document.querySelector<HTMLVideoElement>(
            `#${SCANNER_ELEMENT_ID} video`,
          )
          if (liveVideo) {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            const tick = async () => {
              if (cancelled || !ctx) return
              const w = liveVideo.videoWidth
              const h = liveVideo.videoHeight
              if (w && h) {
                canvas.width = w
                canvas.height = h
                ctx.drawImage(liveVideo, 0, 0, w, h)
                try {
                  const text = await decodeBarcodeFromImageData(
                    ctx.getImageData(0, 0, w, h),
                  )
                  if (!cancelled && text) {
                    handleHit(text)
                    return
                  }
                } catch {
                  /* ignore a bad frame; the next tick retries */
                }
              }
              if (!cancelled) loopTimer = setTimeout(tick, 200)
            }
            void tick()
          }
        }

        if (cancelled) {
          await scanner.stop().catch(() => {})
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        const friendly = /denied|NotAllowed/i.test(msg)
          ? 'Camera access was blocked. Allow it in browser settings, then try again.'
          : /NotFound/i.test(msg)
            ? 'No camera found on this device. Use the USB scanner or paste the code instead.'
            : msg
        setError(friendly)
      }
    }
    void start()

    return () => {
      cancelled = true
      if (loopTimer) clearTimeout(loopTimer)
      const s = scannerRef.current
      scannerRef.current = null
      if (s && s.isScanning) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {})
      }
    }
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <>
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
                {/* html5-qrcode injects its <video> here; the global rule
                    in index.css forces it to object-fit:cover this square
                    so the preview keeps its true aspect (no stretch). */}
                <div id={SCANNER_ELEMENT_ID} className="h-full w-full" />
                {/* Our own centred guide box — a real square for QR, a
                    wide band for barcodes — drawn over the feed. */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={
                      mode === 'barcode'
                        ? 'h-[26%] w-[70%] rounded-lg border-2 border-white/90 shadow-[0_0_0_2px_rgba(0,0,0,0.25)]'
                        : 'aspect-square w-[72%] rounded-lg border-2 border-white/90 shadow-[0_0_0_2px_rgba(0,0,0,0.25)]'
                    }
                  />
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {mode === 'barcode'
                  ? 'Hold the label flat about 15–20 cm away so the bars look sharp — it doesn’t need to fill the box. Keep steady; it scans on its own.'
                  : 'Hold the QR code steady inside the square frame. The scanner auto-detects and closes when it reads a code.'}
              </p>
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
