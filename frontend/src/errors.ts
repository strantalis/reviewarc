export function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The operation did not complete. Check the local logs and try again.'
}
