"""python -m telios_worker <command> …  — each command prints JSON on stdout.

  ingest    <original> <design-dir>                         prepare and measure an upload
  pdfpages  <pdf> <out-dir> [--max 10] [--dpi 300]          each page as a PNG
  vectorize <trace.png> <out-dir> --palette JSON [--width W --height H]
  trace     <source.png> <out-dir> [--palette JSON] [--mode full|neutral|one-ink] [--keep-background]
  rebuild   <crop.png> <out-dir> --reading JSON [--analysis analysis.json]
  unzip     <zip> <out-dir> [--max-files N] [--max-bytes B]    the pictures in a zip
  eps       <eps> <out.png> [--longest 2048]                    an EPS drawn as pixels
  raster    <picture> <out.png>                                 any picture Pillow reads, as PNG
  whiten    <in.png> <out.png>                                  a scan's paper made white
  key       <in.png> <out.png> [--ground white|black] [--everything]   a plain background made clear
  pickkey   <in.png>                                            the key color (green or blue) a picture can be cut out of
  ground    <in.png> <out.png> [--color #00ff00]                a picture's white ground painted in a key color
  chroma    <in.png> <out.png> [--color green|blue]             a picture on a key-color backdrop cut out of it
  pack      <manifest.json> <out.zip>                           files packed into a zip
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
    u = sub.add_parser('unzip')
    u.add_argument('zip')
    u.add_argument('outdir')
    u.add_argument('--max-files', type=int, default=1000)
    u.add_argument('--max-bytes', type=int, default=4_000_000_000)
    e = sub.add_parser('eps')
    e.add_argument('source')
    e.add_argument('out')
    e.add_argument('--longest', type=int, default=2048)
    ra = sub.add_parser('raster')
    ra.add_argument('source')
    ra.add_argument('out')
    wh = sub.add_parser('whiten')
    wh.add_argument('source')
    wh.add_argument('out')
    k = sub.add_parser('key')
    k.add_argument('source')
    k.add_argument('out')
    k.add_argument('--ground', default='white', choices=['white', 'black'])
    k.add_argument('--everything', action='store_true')
    k.add_argument('--no-window', action='store_true', help='no enclosed patch is cleared: a character, not a frame')
    pc = sub.add_parser('pickkey')
    pc.add_argument('source')
    gr = sub.add_parser('ground')
    gr.add_argument('source')
    gr.add_argument('out')
    gr.add_argument('--color', default='#00ff00')
    ch = sub.add_parser('chroma')
    ch.add_argument('source')
    ch.add_argument('out')
    ch.add_argument('--color', default='green', choices=['green', 'blue'])
    pk = sub.add_parser('pack')
    pk.add_argument('manifest')
    pk.add_argument('out')
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
        elif args.cmd in ('unzip', 'eps', 'raster', 'whiten', 'key', 'pickkey', 'ground', 'chroma', 'pack'):
            from . import restyle
            if args.cmd == 'unzip':
                os.makedirs(args.outdir, exist_ok=True)
                out(restyle.unzip(args.zip, args.outdir, args.max_files, args.max_bytes))
            elif args.cmd == 'eps':
                out(restyle.eps(args.source, args.out, args.longest))
            elif args.cmd == 'raster':
                out(restyle.raster(args.source, args.out))
            elif args.cmd == 'whiten':
                out(restyle.whiten(args.source, args.out))
            elif args.cmd == 'key':
                out(restyle.key(args.source, args.out, args.ground, args.everything, window=2.0 if args.no_window else 0.04))
            elif args.cmd == 'pickkey':
                out(restyle.pick_key(args.source))
            elif args.cmd == 'ground':
                out(restyle.ground(args.source, args.out, args.color))
            elif args.cmd == 'chroma':
                out(restyle.chroma(args.source, args.out, args.color))
            else:
                out(restyle.pack(json.load(open(args.manifest)), args.out))
    except Exception as e:  # reported to the job worker, which shows it
        import traceback
        traceback.print_exc(file=sys.stderr)
        fail(f'{type(e).__name__}: {e}')


if __name__ == '__main__':
    main()
