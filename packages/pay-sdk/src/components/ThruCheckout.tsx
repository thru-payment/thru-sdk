import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { usePayment, type PublicPayment, type ThruTheme } from '@thru-payment/checkout-core';
import { ThruRoot, partClass } from './primitives';
import { PaymentAmount } from './PaymentAmount';
import { PaymentAddress } from './PaymentAddress';
import { PaymentQRCode } from './PaymentQRCode';
import { PaymentStatusBadge } from './PaymentStatusBadge';

export type ThruCheckoutClassNames = {
  root?: string;
  header?: string;
  amount?: string;
  status?: string;
  qr?: string;
  address?: string;
  footer?: string;
};

export type ThruCheckoutLabels = {
  loading?: string;
  notFound?: string;
  instruction?: (payment: PublicPayment) => string;
};

export function ThruCheckout({
  paymentId,
  qrValue,
  qrSize,
  intervalMs,
  unstyled,
  className,
  style,
  classNames,
  theme,
  labels,
  onStatusChange,
  renderHeader,
  renderFooter,
}: {
  /** A payment created by your backend (POST /v1/payments). */
  paymentId?: string;
  /** Override the QR value (defaults to the payment address). */
  qrValue?: string;
  qrSize?: number;
  intervalMs?: number;
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
  classNames?: ThruCheckoutClassNames;
  theme?: ThruTheme;
  labels?: ThruCheckoutLabels;
  onStatusChange?: (payment: PublicPayment) => void;
  renderHeader?: (payment: PublicPayment) => ReactNode;
  renderFooter?: (payment: PublicPayment) => ReactNode;
}) {
  const { data: payment, error } = usePayment(paymentId, { intervalMs });

  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (payment && payment.status !== lastStatus.current) {
      lastStatus.current = payment.status;
      onStatusChange?.(payment);
    }
  }, [payment, onStatusChange]);

  return (
    <ThruRoot
      unstyled={unstyled}
      theme={theme}
      className={partClass(unstyled, 'thru-checkout', classNames?.root, className)}
      style={style}
    >
      {!payment ? (
        <div className={partClass(unstyled, 'thru-muted')}>
          {error ? labels?.notFound ?? 'Payment unavailable' : labels?.loading ?? 'Loading...'}
        </div>
      ) : (
        <>
          {renderHeader ? (
            renderHeader(payment)
          ) : (
            <div className={partClass(unstyled, 'thru-row', classNames?.header)}>
              <PaymentAmount
                amount={payment.expectedAmount}
                token={payment.token}
                received={payment.receivedAmount}
                unstyled={unstyled}
                className={classNames?.amount}
              />
              <PaymentStatusBadge
                status={payment.status}
                unstyled={unstyled}
                className={classNames?.status}
              />
            </div>
          )}

          <PaymentQRCode
            value={qrValue ?? payment.paymentAddress}
            size={qrSize}
            unstyled={unstyled}
            className={classNames?.qr}
          />
          <PaymentAddress
            address={payment.paymentAddress}
            unstyled={unstyled}
            className={classNames?.address}
          />

          {renderFooter ? (
            renderFooter(payment)
          ) : (
            <div className={partClass(unstyled, 'thru-muted', classNames?.footer)}>
              {labels?.instruction
                ? labels.instruction(payment)
                : `Send exactly ${payment.expectedAmount} ${payment.token} on ${payment.chain}.`}
            </div>
          )}
        </>
      )}
    </ThruRoot>
  );
}
