import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * A real QR to the join page with the code already filled in.
 *
 * Typing a four-letter code is not hard, but it is four more chances to end up in
 * the wrong room, and a party has no patience for that. The deep link carries
 * ?join=CODE, which session.js consumes exactly once and then strips.
 *
 * Rendered in ink on paper rather than pure black on white so it belongs to the
 * page — QR tolerates the contrast easily, and the night edition inverts safely
 * because the quiet zone comes from the light module colour.
 */
export default function JoinQR({ code, size = 320 }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!code) return undefined;
    let live = true;

    const url = new URL(window.location.href);
    url.searchParams.set('join', code);
    url.hash = '';

    // Read the resolved tokens rather than hardcoding, so the night edition gets a
    // QR that is actually scannable instead of a black square on charcoal.
    const styles = getComputedStyle(document.documentElement);
    const dark = styles.getPropertyValue('--ink').trim() || '#17140F';
    const light = styles.getPropertyValue('--paper').trim() || '#F2EEE3';

    QRCode.toDataURL(url.toString(), {
      width: size * 2, // 2x so it stays crisp on a television
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark, light },
    })
      .then((d) => { if (live) setSrc(d); })
      .catch(() => { if (live) setSrc(null); });

    return () => { live = false; };
  }, [code, size]);

  // Sized by CSS (.jq-img), not by an inline style — the displayed size is fluid
  // and an inline width would beat the stylesheet and pin it.
  if (!src) return <div className="jq-placeholder" />;
  return <img className="jq-img" src={src} alt={`Scan to join room ${code}`} />;
}
