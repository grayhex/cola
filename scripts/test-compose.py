#!/usr/bin/env python3
import json, os, subprocess
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def config(file,env):
    return subprocess.run(['docker','compose','-f',file,'config','--format','json'],cwd=root,env=env,capture_output=True,text=True)
env={k:v for k,v in os.environ.items() if k not in ['POSTGRES_PASSWORD','APP_ORIGIN','COOKIE_SECURE','TRUSTED_PROXY_KEY','BIKE_RESOLVER_TOKEN']}
assert config('compose.yaml',env).returncode==0
assert config('compose.prod.yaml',env).returncode!=0
env.update(POSTGRES_PASSWORD='1a'*32,APP_ORIGIN='https://colabike.ru',COOKIE_SECURE='true',TRUSTED_PROXY_KEY='2b'*32,BIKE_RESOLVER_TOKEN='3c'*32)
r=config('compose.prod.yaml',env)
assert r.returncode==0,r.stderr
s=json.loads(r.stdout)['services']
assert not s['db'].get('ports') and not s['bike-resolver'].get('ports')
assert len(s['app']['ports'])==1
assert s['app']['ports'][0]['host_ip']=='127.0.0.1'
assert str(s['app']['ports'][0]['published'])=='3000'
assert s['app']['environment']['DEPLOYMENT_MODE']=='production'
print('Compose: local remains simple; production requires secrets and publishes only loopback app port.')
