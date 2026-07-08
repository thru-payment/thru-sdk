import { useState } from 'react';
import { shorten } from '../format';
import { partClass } from './primitives';

export function PaymentAddress({
  address,
  truncate = true,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  unstyled,
  className,
  classNames,
}: {
  address: string;
  truncate?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  unstyled?: boolean;
  className?: string;
  classNames?: { root?: string; value?: string; button?: string };
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={partClass(unstyled, 'thru-address', classNames?.root, className)}>
      <span
        className={partClass(unstyled, 'thru-address-value', classNames?.value)}
        title={address}
      >
        {truncate ? shorten(address, 10, 8) : address}
      </span>
      <button
        type="button"
        onClick={copy}
        className={partClass(unstyled, 'thru-button', classNames?.button)}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
