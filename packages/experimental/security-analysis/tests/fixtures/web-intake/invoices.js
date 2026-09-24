/** Owned, non-networked fixture for the security harness acceptance task. */
export const CASE_ID = 'DSH_INTAKE_WEB_V1'
const invoices = new Map([['invoice-a', { ownerId: 'alice', amount: 12 }]])
export function readInvoice(currentUser, invoiceId) {
  if (!currentUser) throw new Error('Authentication required')
  return invoices.get(invoiceId)
}
export function readOwnInvoice(currentUser, invoiceId) {
  if (!currentUser) throw new Error('Authentication required')
  const invoice = invoices.get(invoiceId)
  if (!invoice || invoice.ownerId !== currentUser.id) throw new Error('Forbidden')
  return invoice
}
