#!/usr/bin/env python3
"""Short write outage gives one coherent DB/photos snapshot. No cloud dependency."""
import argparse, datetime, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, uuid, fcntl

ROOT=pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)
COMPOSE=['docker','compose']
if os.environ.get('COLA_ENV_FILE'): COMPOSE += ['--env-file',os.environ['COLA_ENV_FILE']]
for f in os.environ.get('COLA_COMPOSE_FILES','compose.yaml').split(os.pathsep): COMPOSE += ['-f',f]
def run(args, **kwargs): return subprocess.run(args,check=True,**kwargs)
def output(args): return subprocess.check_output(args,text=True).strip()
def compose(*args,**kwargs): return run(COMPOSE+list(args),**kwargs)
def sha(file):
    h=hashlib.sha256()
    with open(file,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def app_id():
    value=output(COMPOSE+['ps','-aq','app'])
    if not value or '\n' in value: raise RuntimeError('Exactly one app container must exist (docker compose create app)')
    return value
def image(container): return output(['docker','inspect','--format','{{.Config.Image}}',container])
def valid_archive(file):
    with tarfile.open(file,'r:gz') as archive:
        for member in archive:
            p=pathlib.PurePosixPath(member.name)
            if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
                raise RuntimeError('Unsafe member in photo archive')
            if len(p.parts)>1: raise RuntimeError('Unexpected nested photo path')
def validate(folder):
    m=json.loads((folder/'manifest.json').read_text())
    if m.get('format') not in ('colabike-backup-v1','colabike-backup-v2'): raise RuntimeError('Unknown backup format')
    for name in ['database.dump','photos.tar.gz'] + (['rides.tar.gz'] if m['format']=='colabike-backup-v2' else []):
        file=folder/name
        if file.is_symlink() or sha(file)!=m['sha256'][name]: raise RuntimeError('Backup checksum mismatch: '+name)
    valid_archive(folder/'photos.tar.gz')
    if m['format']=='colabike-backup-v2': valid_archive(folder/'rides.tar.gz')
    return m
def backup(dest,keep):
    dest.mkdir(parents=True,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    final=dest/('colabike-'+stamp+'-'+uuid.uuid4().hex[:8])
    temporary=pathlib.Path(tempfile.mkdtemp(prefix='.partial-',dir=dest))
    os.chmod(temporary,0o700)
    running=output(COMPOSE+['ps','--services','--status','running']).splitlines()
    resume=[s for s in ['app','bike-resolver'] if s in running]
    try:
        container=app_id()
        compose('stop','app','bike-resolver')
        with open(temporary/'database.dump','wb') as file:
            compose('exec','-T','db','pg_dump','-U','colabike','-d','colabike','-Fc',stdout=file)
        with open(temporary/'photos.tar.gz','wb') as file:
            run(['docker','run','--rm','--user','0','--volumes-from',container+':ro','--entrypoint','tar',image(container),'-C','/app/uploads','-czf','-','.'],stdout=file)
        with open(temporary/'rides.tar.gz','wb') as file:
            run(['docker','run','--rm','--user','0','--volumes-from',container+':ro','--entrypoint','tar',image(container),'-C','/app/rides','-czf','-','.'],stdout=file)
        manifest={'format':'colabike-backup-v2','createdAt':stamp,'appImage':image(container),'appImageId':output(['docker','inspect','--format','{{.Image}}',container]),'sha256':{n:sha(temporary/n) for n in ['database.dump','photos.tar.gz','rides.tar.gz']}}
        (temporary/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        validate(temporary)
        temporary.rename(final)
    finally:
        try:
            if resume: compose('start',*resume)
        finally:
            # Incomplete archives are never published or eligible for retention cleanup.
            if temporary.exists(): shutil.rmtree(temporary)
    candidates=[]
    for p in dest.glob('colabike-*'):
        if p.is_symlink() or not p.is_dir(): continue
        try: validate(p); candidates.append(p)
        except Exception: continue
    for p in sorted(candidates,key=lambda p:p.name,reverse=True)[keep:]: shutil.rmtree(p)
    print(str(final))
def restore(folder,yes):
    if not yes: raise RuntimeError('Restore requires --yes into an EMPTY Compose environment')
    manifest=validate(folder)  # Verify every byte before touching the destination.
    compose('stop','app','bike-resolver')
    compose('up','-d','--wait','db')
    count=output(COMPOSE+['exec','-T','db','psql','-U','colabike','-d','colabike','-Atc',"SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','bike_resolver')"])
    if count!='0': raise RuntimeError('Destination database is not empty; restore refused')
    compose('create','--build','--no-recreate','app')
    container=app_id()
    names=output(['docker','run','--rm','--volumes-from',container+':ro','--entrypoint','ls',image(container),'-A','/app/uploads'])
    if names: raise RuntimeError('Destination photos volume is not empty; restore refused')
    ride_names=output(['docker','run','--rm','--volumes-from',container+':ro','--entrypoint','ls',image(container),'-A','/app/rides'])
    if ride_names: raise RuntimeError('Destination rides volume is not empty; restore refused')
    with open(folder/'database.dump','rb') as file:
        compose('exec','-T','db','pg_restore','-U','colabike','-d','colabike','--no-owner','--exit-on-error','--single-transaction',stdin=file)
    with open(folder/'photos.tar.gz','rb') as file:
        run(['docker','run','--rm','-i','--user','0','--volumes-from',container,'--entrypoint','tar',image(container),'-C','/app/uploads','-xzf','-'],stdin=file)
    if manifest['format']=='colabike-backup-v2':
        with open(folder/'rides.tar.gz','rb') as file:
            run(['docker','run','--rm','-i','--user','0','--volumes-from',container,'--entrypoint','tar',image(container),'-C','/app/rides','-xzf','-'],stdin=file)
    print('Restored DB, rides and photos. Services remain stopped; run compose up -d --wait and smoke checks.')
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['backup','restore','verify'])
    parser.add_argument('--destination',default=os.environ.get('BACKUP_DEST'))
    parser.add_argument('--backup')
    parser.add_argument('--keep',type=int,default=7)
    parser.add_argument('--yes',action='store_true')
    args=parser.parse_args()
    try:
        lock=open(os.environ.get('COLA_OPERATIONS_LOCK','/var/lock/colabike-deploy.lock'),'a')
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.action=='backup':
            if not args.destination or args.keep<1: raise RuntimeError('Specify --destination and --keep >= 1')
            backup(pathlib.Path(args.destination).resolve(),args.keep)
        elif args.backup:
            folder=pathlib.Path(args.backup).resolve()
            restore(folder,args.yes) if args.action=='restore' else validate(folder)
        else: raise RuntimeError('Specify --backup directory')
    except Exception as e:
        print('Backup/restore failed: '+str(e),file=__import__('sys').stderr)
        raise SystemExit(1)
