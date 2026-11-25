"""Local private ingestion worker. Requires ffmpeg, ffprobe and Poppler for previews."""
import argparse, hashlib, json, shutil, subprocess, re
from pathlib import Path

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=120, check=True).stdout

def ingest(source, vault):
    digest=hashlib.sha256()
    with source.open('rb') as f:
        for chunk in iter(lambda:f.read(1048576),b''): digest.update(chunk)
    key=digest.hexdigest()
    dest=vault/key
    dest.mkdir(parents=True,exist_ok=True)
    original=dest/('original'+source.suffix.lower())
    if not original.exists(): shutil.copy2(source,original)
    record={'sha256':key,'original_filename':source.name,'title':source.stem,'publication':'private','rights':'pending','warnings':[]}
    try:
        if source.suffix.lower()=='.pdf':
            info=run(['pdfinfo',str(original)])
            fields=dict(line.split(':',1) for line in info.splitlines() if ':' in line)
            record['title']=fields.get('Title','').strip() or source.stem
            record['pages']=int(fields['Pages'].strip())
            run(['pdftoppm','-f','1','-l','1','-scale-to','640','-singlefile','-png',str(original),str(dest/'cover')])
        elif source.suffix.lower() in ('.mp4','.mov','.mkv','.webm','.avi'):
            record['media']=json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(original)]))
            run(['ffmpeg','-nostdin','-y','-i',str(original),'-frames:v','1','-vf','scale=640:-2',str(dest/'cover.png')])
        elif source.suffix.lower()=='.txt':
            record['text_import_pending']=True
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as e:
        record['warnings'].append(str(e))
    record['proposed_filename']=(re.sub(r'[^\w-]+','-',record['title']).strip('-')[:100] or key[:12])+source.suffix.lower()
    (dest/'metadata.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    return record

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path)
    p.add_argument('vault',type=Path)
    a=p.parse_args()
    if not a.source.is_file(): p.error('source must be a file')
    print(json.dumps(ingest(a.source,a.vault),indent=2))
