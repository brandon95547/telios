"""python -m telios_worker <command> …  — each command prints JSON on stdout.

  ingest    <original> <design-dir>                         prepare and measure an upload
  pdfpages  <pdf> <out-dir> [--max 10] [--dpi 300]          each page as a PNG
  vectorize <trace.png> <out-dir> --palette JSON [--width W --height H]
  trace     <source.png> <out-dir> [--palette JSON] [--mode full|neutral|one-ink] [--keep-background]
  rebuild   <crop.png> <out-dir> --reading JSON [--analysis analysis.json]
"""
import argparse
import json
import os
import sys

from .common import fail, out


def pdfpages(pdf, outdir, max_pages=10, dpi=300):
    import fitz
    doc = fitz.open(pdf)
    pages = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        path = os.path.join(outdir, f'page-{i + 1}.png')
        images = page.get_images(full=True)
        done = False
        if len(images) == 1:
            # a scanned page: one image covering the page, taken at its own resolution
            xref = images[0][0]
            rects = page.get_image_rects(xref)
            if rects and rects[0].width * rects[0].height > 0.8 * page.rect.width * page.rect.height:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if max(pix.width, pix.height) <= 6000:
                    pix.save(path)
                    done = True
        if not done:
            zoom = dpi / 72
            longest = max(page.rect.width, page.rect.height) * zoom
            if longest > 4000:
                zoom *= 4000 / longest
            page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).save(path)
        pages.append({'page': i + 1, 'file': path})
    return {'pages': pages, 'total': len(doc)}


def main(argv=None):
    ap = argparse.ArgumentParser(prog='telios_worker')
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('ingest')
    a.add_argument('original')
    a.add_argument('outdir')
    p = sub.add_parser('pdfpages')
    p.add_argument('pdf')
    p.add_argument('outdir')
    p.add_argument('--max', type=int, default=10)
    p.add_argument('--dpi', type=int, default=300)
    v = sub.add_parser('vectorize')
    v.add_argument('trace')
    v.add_argument('outdir')
    v.add_argument('--palette', required=True, help='JSON list of {hex, name}')
    v.add_argument('--width', type=float)
    v.add_argument('--height', type=float)
    v.add_argument('--title', default='Telios')
    t = sub.add_parser('trace')
    t.add_argument('source')
    t.add_argument('outdir')
    t.add_argument('--palette', help='JSON list of {hex, name}')
    t.add_argument('--mode', default='full', choices=['full', 'neutral', 'one-ink'])
    t.add_argument('--keep-background', action='store_true')
    t.add_argument('--max-colors', type=int, default=8)
    t.add_argument('--title', default='Telios')
    r = sub.add_parser('rebuild')
    r.add_argument('source')
    r.add_argument('outdir')
    r.add_argument('--reading', required=True, help='JSON: the confirmed reading')
    r.add_argument('--analysis', help='analysis.json from ingest')
    r.add_argument('--title', default='Telios')
    args = ap.parse_args(argv)

    try:
        if args.cmd == 'ingest':
            from .analyze import ingest
            os.makedirs(args.outdir, exist_ok=True)
            out(ingest(args.original, args.outdir))
        elif args.cmd == 'pdfpages':
            os.makedirs(args.outdir, exist_ok=True)
            out(pdfpages(args.pdf, args.outdir, args.max, args.dpi))
        elif args.cmd == 'vectorize':
            from .vectorize import vectorize
            os.makedirs(args.outdir, exist_ok=True)
            out(vectorize(args.trace, json.loads(args.palette), args.outdir, args.width, args.height, args.title))
        elif args.cmd == 'trace':
            from .trace import trace
            os.makedirs(args.outdir, exist_ok=True)
            pal = json.loads(args.palette) if args.palette else None
            out(trace(args.source, args.outdir, pal, args.mode, args.keep_background, args.max_colors, args.title))
        elif args.cmd == 'rebuild':
            from .rebuild import rebuild
            os.makedirs(args.outdir, exist_ok=True)
            analysis = json.load(open(args.analysis)) if args.analysis else None
            out(rebuild(args.source, args.outdir, json.loads(args.reading), analysis, args.title))
    except Exception as e:  # reported to the job worker, which shows it
        import traceback
        traceback.print_exc(file=sys.stderr)
        fail(f'{type(e).__name__}: {e}')


if __name__ == '__main__':
    main()
