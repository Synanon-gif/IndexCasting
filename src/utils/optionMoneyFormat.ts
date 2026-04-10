/** Shared currency prefix for option/casting negotiation UI (matches existing inline patterns). */
export function formatOptionMoneyAmount(amount: number, currency: string | undefined): string {
  const sym = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€';
  return `${sym}${amount}`;
}
