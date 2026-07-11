/**
 * Returns the current date and time in a human-readable format.
 */
export const getPrettyPrintNow = () =>
  new Date().toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
