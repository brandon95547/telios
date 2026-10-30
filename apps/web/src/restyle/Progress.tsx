import { useEffect, useState } from 'react';
import { progressAt, type RestyleResult } from '@telios/shared';

/** The server's clock, as this page sees it: now, in ms, kept moving while something is drawing. */
function useNow(skew: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    if (!on) return;
    const t = setInterval(() => setNow(Date.now() + skew), 500);
    return () => clearInterval(t);
  }, [skew, on]);
  return now;
}

/** How far one result has come, 0 to 1: nothing while it waits, the finished stages and a share of the current one while it draws. */
const shareOf = (r: RestyleResult, now: number) => (r.status === 'running' && r.progress ? progressAt(r.progress, now) : 0);

export function Bar({ share, label }: { share: number; label: string }) {
  const pct = Math.min(100, Math.round(share * 100));
  return (
    <span className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ transform: `scaleX(${pct / 100})` }} />
    </span>
  );
}

/** A tile's wait: what it is doing and how far along. */
export function TileProgress({ result, skew }: { result: RestyleResult; skew: number }) {
  const now = useNow(skew, result.status === 'running');
  const share = shareOf(result, now);
  const words = result.status === 'queued' ? 'Waiting' : result.stage ?? 'Drawing';
  return (
    <span className="tile-wait">
      <span className="spinner" />
      <span>{words}{result.status === 'running' && result.progress ? ` · ${Math.min(100, Math.round(share * 100))}%` : ''}</span>
      <Bar share={share} label={`${words}: ${result.inputName}`} />
    </span>
  );
}

/** The whole batch: the pictures drawn so far and the part-drawn ones, of every picture in the batches still going. */
export function BatchProgress({ results, skew }: { results: RestyleResult[]; skew: number }) {
  const going = new Set(results.filter((r) => r.status === 'queued' || r.status === 'running').map((r) => r.batchId));
  const now = useNow(skew, going.size > 0);
  if (!going.size) return null;
  const batch = results.filter((r) => going.has(r.batchId) && r.status !== 'canceled');
  const finished = batch.filter((r) => r.status === 'done' || r.status === 'failed').length;
  const share = (finished + batch.reduce((n, r) => n + shareOf(r, now), 0)) / batch.length;
  return (
    <div className="batch-progress">
      <Bar share={share} label="Pictures drawn" />
      <span className="sub">{finished} of {batch.length} drawn · {Math.min(100, Math.round(share * 100))}%</span>
    </div>
  );
}
