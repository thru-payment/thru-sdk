# Payments & refunds

## Create a payment

```ts
const payment = await thru.payments.create({
  chain: 'base',       // any supported chain: base, solana, tron, sui, ethereum, ...
  token: 'USDC',
  amount: '25.00',     // decimal string — never a float
  currency: 'USD',
  network: 'mainnet',  // default
  metadata: { orderId: 'ord_1024' },
});
```

You get back a `paymentAddress` (a real, key-controlled address on that chain) with a
fixed `expectedAmount` and `expiresAt`. Amounts are always **decimal strings** to avoid
floating-point precision loss.

Supported chains include EVM networks (Ethereum, Base, BNB, Polygon, Arbitrum, Optimism,
Avalanche, ...), Sui, Solana and Tron for key-controlled settlement — see the `CHAINS`
export for the full list.

## Read payments

```ts
await thru.payments.retrieve(payment.id);
await thru.payments.list({ status: 'confirmed', network: 'mainnet' });
```

Statuses: `waiting_for_payment → detected → confirming → confirmed → settled`, plus
`underpaid`, `overpaid`, `expired`, `failed`, `refunded`.

## Refunds

Refunds return funds to the payer over the same rail. You can refund the full amount or a
partial amount (up to what was received, net of any platform fee).

```ts
// full refund → payment becomes `refunded`
await thru.refunds.create(payment.id);

// partial refund
await thru.refunds.create(payment.id, { amount: '10.00', reason: 'goodwill' });

await thru.refunds.list();
```

## Balances & settlement

```ts
// confirmed balances per chain/token (net of withheld fees)
await thru.balances.list();

// where funds auto-sweep to — set once per chain
await thru.settlement.set({ chain: 'base', address: '0xYourTreasury' });
await thru.settlement.list();

// auto-sweep history
await thru.sweeps.list();
```

Received funds auto-sweep to your settlement address (EVM, Solana and Tron). Native-asset
sweeps are automatic; token sweeps on Solana/Tron require an operator-funded gas tank.
