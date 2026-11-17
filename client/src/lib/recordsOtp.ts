// Tiny bridge between the api client and the OTP popup (RecordsOtpModal).
// api.ts calls askRecordsOtp() when the server says a recorded order/payment needs the admin-email OTP;
// the popup resolves it with the verified token (or null if the admin cancels).
type Resolver = (token: string | null) => void

let pending: Promise<string | null> | null = null
let resolver: Resolver | null = null

export const askRecordsOtp = (): Promise<string | null> => {
  if (!pending) {
    pending = new Promise<string | null>((resolve) => {
      resolver = (t) => { pending = null; resolver = null; resolve(t) }
      window.dispatchEvent(new CustomEvent('records-otp-needed'))
    })
  }
  return pending
}

export const finishRecordsOtp = (token: string | null) => {
  if (token) sessionStorage.setItem('records_otp_token', token)
  resolver?.(token)
}
