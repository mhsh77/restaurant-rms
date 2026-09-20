/**
 * Money formatting for audit summaries and CSV. The UI formats with Persian digits itself.
 * Amounts are integer minor units; with currency_decimals = 0 (Toman) minor === major.
 */
export function toMajor(restaurant, minor) {
  return (minor / 10 ** restaurant.currency_decimals).toFixed(restaurant.currency_decimals);
}

export function formatMoney(restaurant, minor) {
  const d = restaurant.currency_decimals;
  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${nf.format(minor / 10 ** d)} ${restaurant.currency_symbol}`;
}
