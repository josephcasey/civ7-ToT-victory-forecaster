#!/usr/bin/env python3
"""Generate a resolved workshop_build_item VDF from workshop.vdf.

Two modes, because Steam will not reliably take content and a preview image in
the same call:

  content  appid, publishedfileid, contentfolder, visibility, title,
           description, changenote.  NO previewfile.
  preview  appid, publishedfileid, previewfile.  Nothing else.

`contentfolder` is optional in workshop_build_item, and omitting it leaves the
item's existing files untouched - which is what makes the preview-only call safe
to run straight after the content call.

Usage:
  build_workshop_vdf.py --mode content --out FILE --contentfolder DIR [--changenote T]
  build_workshop_vdf.py --mode preview --out FILE --previewfile FILE --id ID
"""
import argparse
import os
import re
import sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'workshop.vdf')


def read_source():
    with open(SRC, encoding='utf-8') as fh:
        text = fh.read()

    def simple(key):
        m = re.search(r'"%s"\s*"([^"]*)"' % key, text)
        return m.group(1) if m else ''

    # description is multi-line, so it is bounded by the key that follows it
    m = re.search(r'"description"\s*"(.*?)"\n\t"changenote"', text, re.S)
    description = m.group(1) if m else ''

    return {
        'appid': simple('appid'),
        'publishedfileid': simple('publishedfileid'),
        'visibility': simple('visibility'),
        'title': simple('title'),
        'description': description,
        'changenote': simple('changenote'),
    }


def check_description(description):
    """A straight double quote becomes \\" in the VDF and Steam's parser stops
    there, silently truncating everything after it. Refuse rather than publish a
    half description."""
    if '"' in description:
        sys.exit('workshop.vdf: description contains a straight double quote, which '
                 'truncates the Steam description. Use curly quotes instead.')
    if '\\' in description:
        sys.exit('workshop.vdf: description contains a backslash, which Steam will mangle.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=('content', 'preview'), required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--contentfolder')
    ap.add_argument('--previewfile')
    ap.add_argument('--changenote')
    ap.add_argument('--id')
    args = ap.parse_args()

    data = read_source()
    published = args.id or data['publishedfileid']

    lines = ['"workshopitem"', '{', '\t"appid"\t\t\t"%s"' % data['appid'],
             '\t"publishedfileid"\t"%s"' % published]

    if args.mode == 'content':
        check_description(data['description'])
        if not args.contentfolder:
            sys.exit('--contentfolder is required in content mode')
        if not os.path.isabs(args.contentfolder):
            sys.exit('contentfolder must be an absolute path')
        note = args.changenote or data['changenote']
        lines += [
            '\t"contentfolder"\t\t"%s"' % args.contentfolder,
            '\t"visibility"\t\t"%s"' % data['visibility'],
            '\t"title"\t\t\t"%s"' % data['title'],
            '\t"description"\t\t"%s"' % data['description'],
            '\t"changenote"\t\t"%s"' % note,
        ]
    else:
        if not published:
            sys.exit('preview mode needs a publishedfileid - publish the content first')
        if not args.previewfile or not os.path.isabs(args.previewfile):
            sys.exit('--previewfile must be an absolute path')
        if not os.path.isfile(args.previewfile):
            sys.exit('preview file not found: %s' % args.previewfile)
        size = os.path.getsize(args.previewfile)
        if size > 1_000_000:
            sys.exit('preview is %.2f MB; Steam silently rejects previews over 1 MB' % (size / 1e6))
        if os.path.splitext(args.previewfile)[1].lower() not in ('.png', '.jpg', '.jpeg', '.gif'):
            sys.exit('preview must be PNG, JPG or GIF')
        lines.append('\t"previewfile"\t\t"%s"' % args.previewfile)

    lines.append('}')
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    print('wrote %s (%s mode)' % (args.out, args.mode))


if __name__ == '__main__':
    main()
