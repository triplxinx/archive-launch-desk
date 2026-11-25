"""Inventory an extracted legacy website without executing its content."""
import argparse
import json
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote

class Inventory(HTMLParser):
    def __init__(self, page, root):
        super().__init__(convert_charrefs=True)
        self.page, self.root, self.items = page, root, []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        keys = {'a':['href'],'img':['src','srcset'],'video':['src','poster'],'audio':['src'],'source':['src','srcset'],'iframe':['src'],'script':['src'],'link':['href'],'object':['data'],'embed':['src'],'form':['action'],'button':[],'input':[]}
        if tag not in keys: return
        for key in keys[tag] or ['id']:
            value = a.get(key) or ''
            if not value and tag not in ('button','input','form'): continue
            u = urlsplit(value)
            status = 'review_interaction'
            if u.scheme or u.netloc:
                status = 'third_party_review' if u.scheme in ('http','https') or u.netloc else 'special_url_review'
            elif u.path and key != 'srcset':
                target = (self.root / unquote(u.path).lstrip('/') if u.path.startswith('/') else self.page.parent / unquote(u.path)).resolve()
                status = 'outside_export' if not target.is_relative_to(self.root) else ('present_unverified' if target.exists() else 'missing')
            self.items.append(dict(page=str(self.page.relative_to(self.root)),tag=tag,attribute=key,reference=value,status=status,line=self.getpos()[0]))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('directory',type=Path)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    root=args.directory.resolve()
    if not root.is_dir(): p.error('directory must exist')
    items=[]; errors=[]; files=[]
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root): continue
        files.append(dict(path=str(path.relative_to(root)),bytes=path.stat().st_size))
        if path.suffix.lower() not in ('.html','.htm'): continue
        try:
            parser=Inventory(path,root)
            parser.feed(path.read_text(encoding='utf-8',errors='replace'))
            parser.close()
            items.extend(parser.items)
        except Exception as e: errors.append(dict(page=str(path.relative_to(root)),error=str(e)))
    args.output.write_text(json.dumps(dict(files=files,components=items,errors=errors),indent=2),encoding='utf-8')
    print(f'{len(files)} files, {len(items)} references, {len(errors)} parse errors')
if __name__=='__main__': main()
