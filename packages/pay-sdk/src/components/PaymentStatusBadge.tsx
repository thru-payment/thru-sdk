import { cn } from '../cn';
import { statusLabel, statusTone } from '@thru-payment/checkout-core';
import { partClass } from './primitives';

export function PaymentStatusBadge({
  status,
  label,
  unstyled,
  className,
  classNames,
}: {
  status: string;
  label?: string;
  unstyled?: boolean;
  className?: string;
  classNames?: { root?: string };
}) {
  const tone = statusTone(status);
  return (
    <span
      className={partClass(
        unstyled,
        cn('thru-status', `thru-status-${tone}`),
        classNames?.root,
        className,
      )}
    >
      {label ?? statusLabel(status)}
    </span>
  );
}
