export function shippingFee(subtotal) {
  return subtotal > 50 ? 0 : 5;
}
