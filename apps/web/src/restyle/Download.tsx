import { FORMAT_LABEL, mainFile, type RestyleResult } from '@telios/shared';
import { restyle } from '../api.ts';

/** The one download of a result: what it is taken as (its SVG, its app package, its cutout or its picture), and where there is one, a small link to
 * the one other form worth having. A vector's preview picture is only for looking at, so it is not offered. */
export function Download({ r, compact }: { r: RestyleResult; compact?: boolean }) {
  const { format, also } = mainFile(r);
  const hint = format === 'package' ? 'The SVG with its fitting data and checks and the sheet that shows it fitted: what an app takes in' : undefined;
  return (
    <span className="download-one">
      <a className={compact ? 'button small' : 'button'} href={restyle.downloadOne(r.id)} download title={hint} aria-label={`Download ${r.inputName} as ${FORMAT_LABEL[format]}`}>
        {compact ? '⤓' : `Download ${FORMAT_LABEL[format]}`}
      </a>
      {also && <a className="small-link" href={restyle.downloadOne(r.id, also)} download title={also === 'svg' ? 'The drawing alone, without its fitting data' : undefined}>{FORMAT_LABEL[also]} only</a>}
    </span>
  );
}
