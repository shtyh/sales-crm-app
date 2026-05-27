/**
 * Office geofence config + small helpers shared by the clock-in flow.
 * Centralised here so we change one place if the showroom moves.
 */
export const OFFICE = {
  name: 'Proton SWL Motors, Bukit Mertajam',
  // Anchor verified on the ground 2026-05-27 — the original spec coords
  // (5.3449, 100.4891) were ~4.7 km off and put the geofence in the
  // wrong place.
  lat: 5.3073479,
  lng: 100.4691911,
  /** Check-in is permitted only within this radius (metres). */
  radiusM: 500,
} as const

/** When a check-in is considered "late". Local hour in Asia/Kuala_Lumpur. */
export const LATE_AFTER_HOUR = 9

/**
 * Haversine distance (in metres) between two lat/lng pairs.
 * Standard formula — accurate to a few metres at our scale.
 */
export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000 // earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/** Local YYYY-MM-DD for Asia/Kuala_Lumpur, irrespective of the device tz. */
export function malaysiaToday(): string {
  const now = new Date()
  // toLocaleDateString with the en-CA locale conveniently yields
  // ISO-shaped YYYY-MM-DD; pinning timeZone forces the Malaysia calendar.
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
}

/**
 * Promise-y wrapper around navigator.geolocation.getCurrentPosition so
 * callers can `await` it. High-accuracy + 10s timeout + no cached
 * positions older than 30s.
 */
export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000,
    })
  })
}
