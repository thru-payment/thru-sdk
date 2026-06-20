import { type CSSProperties } from 'react';
import { usePlan, useSubscription } from '../hooks';
import { formatDuration } from '../format';
import type { ThruTheme } from '../theme';
import { ThruRoot, partClass } from './primitives';
import { PaymentAddress } from './PaymentAddress';
import { PaymentQRCode } from './PaymentQRCode';
import { PaymentStatusBadge } from './PaymentStatusBadge';

export type DirectPaySubscribeClassNames = {
  root?: string;
  header?: string;
  status?: string;
  qr?: string;
  address?: string;
  footer?: string;
};

export type DirectPaySubscribeLabels = {
  loading?: string;
  notFound?: string;
  payTo?: string;
  hint?: string;
};

export function DirectPaySubscribe({
  planId,
  subscriptionId,
  qrValue,
  qrSize,
  intervalMs,
  unstyled,
  className,
  style,
  classNames,
  theme,
  labels,
}: {
  /** A Direct Pay plan id. */
  planId?: string;
  /** Optional subscription id to show live status / expiry for this customer. */
  subscriptionId?: string;
  qrValue?: string;
  qrSize?: number;
  intervalMs?: number;
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
  classNames?: DirectPaySubscribeClassNames;
  theme?: ThruTheme;
  labels?: DirectPaySubscribeLabels;
}) {
  const { data: plan, error: planError } = usePlan(planId);
  const { data: subscription } = useSubscription(subscriptionId, { intervalMs });

  return (
    <ThruRoot
      unstyled={unstyled}
      theme={theme}
      className={partClass(unstyled, 'thru-checkout', classNames?.root, className)}
      style={style}
    >
      {!plan ? (
        <div className={partClass(unstyled, 'thru-muted')}>
          {planError ? labels?.notFound ?? 'Plan unavailable' : labels?.loading ?? 'Loading...'}
        </div>
      ) : (
        <>
          <div className={partClass(unstyled, 'thru-row', classNames?.header)}>
            <div>
              <div className={partClass(unstyled, 'thru-amount')}>
                <span className={partClass(unstyled, 'thru-amount-value')}>{plan.price}</span>
                <span className={partClass(unstyled, 'thru-amount-token')}>{plan.token}</span>
              </div>
              <div className={partClass(unstyled, 'thru-amount-sub')}>
                per {formatDuration(plan.periodSeconds)}
              </div>
            </div>
            {subscription ? (
              <PaymentStatusBadge
                status={subscription.active ? 'active' : subscription.status}
                unstyled={unstyled}
                className={classNames?.status}
              />
            ) : null}
          </div>

          <PaymentQRCode
            value={qrValue ?? plan.receivingAddress}
            size={qrSize}
            unstyled={unstyled}
            className={classNames?.qr}
          />
          <div className={partClass(unstyled, 'thru-label')}>
            {labels?.payTo ?? 'Pay from your wallet to'}
          </div>
          <PaymentAddress
            address={plan.receivingAddress}
            unstyled={unstyled}
            className={classNames?.address}
          />

          {subscription?.expiresAt ? (
            <div className={partClass(unstyled, 'thru-muted', classNames?.footer)}>
              {subscription.active
                ? `Active until ${new Date(subscription.expiresAt).toLocaleString()}`
                : `Expired ${new Date(subscription.expiresAt).toLocaleString()}`}
            </div>
          ) : (
            <div className={partClass(unstyled, 'thru-muted', classNames?.footer)}>
              {labels?.hint ?? `Each payment adds ${formatDuration(plan.periodSeconds)} of access.`}
            </div>
          )}
        </>
      )}
    </ThruRoot>
  );
}
