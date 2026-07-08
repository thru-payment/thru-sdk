import { useEffect, useState } from 'react';
import { toQrDataUrl } from '../qr';
import { partClass } from './primitives';

export function PaymentQRCode({
  value,
  size = 200,
  dark,
  light,
  alt = 'Payment QR code',
  unstyled,
  className,
  classNames,
}: {
  value: string;
  size?: number;
  dark?: string;
  light?: string;
  alt?: string;
  unstyled?: boolean;
  className?: string;
  classNames?: { root?: string; img?: string };
}) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSrc('');
      return;
    }
    void toQrDataUrl(value, { size: Math.round(size * 1.1), dark, light }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size, dark, light]);

  return (
    <div className={partClass(unstyled, 'thru-qr', classNames?.root, className)}>
      {src ? (
        <img src={src} alt={alt} width={size} height={size} className={classNames?.img} />
      ) : null}
    </div>
  );
}
