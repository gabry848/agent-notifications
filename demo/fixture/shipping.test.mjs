import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingFee } from './shipping.mjs';

test('orders below $50 pay $5 shipping', () => {
  assert.equal(shippingFee(25), 5);
});

test('orders at $50 qualify for free shipping', () => {
  assert.equal(shippingFee(50), 0);
});

test('orders above $50 qualify for free shipping', () => {
  assert.equal(shippingFee(75), 0);
});
