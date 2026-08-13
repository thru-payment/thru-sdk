import { partClass } from './primitives';

export function PaymentAmount({
  amount,
  token,
  received,
  unstyled,
  className,
  classNames,
}: {
  amount: string;
  token: string;
  received?: string;
  unstyled?: boolean;
  className?: string;
  classNames?: { root?: string; value?: string; token?: string; sub?: string };
}) {
  return (
    <div className={className}>
      <div className={partClass(unstyled, 'thru-amount', classNames?.root)}>
        <span className={partClass(unstyled, 'thru-amount-value', classNames?.value)}>{amount}</span>
        <span className={partClass(unstyled, 'thru-amount-token', classNames?.token)}>{token}</span>
      </div>
      {received != null ? (
        <div className={partClass(unstyled, 'thru-amount-sub', classNames?.sub)}>
          Received {received} {token}
        </div>
      ) : null}
    </div>
  );
}
