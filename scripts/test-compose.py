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
assert any(v.get('target')=='/app/rides' for v in s['app']['volumes'])
assert s['app']['environment']['RIDES_DIR']=='/app/rides'
assert s['app']['build']['target']=='runner'
assert s['migrate']['build']['target']=='ops'
assert s['app']['depends_on']['migrate']['condition']=='service_completed_successfully'
assert s['migrate']['depends_on']['db']['condition']=='service_healthy'
assert s['migrate']['restart']=='no'
assert not s['migrate'].get('ports')
assert s['migrate']['environment']==s['app']['environment']
assert 'build' not in s['chat-sync']
assert s['chat-sync']['command']==['node', 'scripts/chat-sync.js']
assert s['chat-sync']['environment']==s['app']['environment']
assert not s['chat-sync'].get('ports')
assert s['chat-sync']['depends_on']['migrate']['condition']=='service_completed_successfully'
# Ask Compose for its actual build graph, including a fresh project name. Only
# migrate may export the shared ops tag; the worker is a local-only consumer.
for file in ['compose.yaml', 'compose.prod.yaml']:
    project_env = {**env, 'COMPOSE_PROJECT_NAME': 'cola-shared-ops-test'}
    services = json.loads(config(file, project_env).stdout)['services']
    assert services['migrate']['image'] == 'cola-shared-ops-test-ops:local'
    assert services['chat-sync']['image'] == services['migrate']['image']
    assert services['migrate']['pull_policy'] == services['chat-sync']['pull_policy'] == 'never'
    plan = subprocess.run(['docker','compose','-f',file,'build','--print'],cwd=root,env=project_env,capture_output=True,text=True)
    assert plan.returncode == 0, plan.stderr
    targets = json.loads(plan.stdout)['target']
    assert set(targets) == {'app', 'migrate', 'bike-resolver'}, targets.keys()
    assert targets['migrate']['tags'] == [services['migrate']['image']]
print('Compose: local remains simple; production requires secrets and publishes only loopback app port.')

assert s["activity-sync"]["image"] == s["migrate"]["image"]
assert s["activity-sync"]["environment"] == s["app"]["environment"]
assert s["activity-sync"]["command"] == ["node","scripts/activity-sync.js"]
assert not s["activity-sync"].get("ports")
assert any(v.get("target")=="/app/rides" for v in s["activity-sync"]["volumes"])
assert s["notification-email"]["image"] == s["migrate"]["image"]
assert s["notification-email"]["pull_policy"] == "never"
assert s["notification-email"]["environment"] == s["app"]["environment"]
assert s["notification-email"]["command"] == ["node", "scripts/notification-email.js"]
assert s["notification-email"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
assert not s["notification-email"].get("ports")

assert s["notification-push"]["image"] == s["migrate"]["image"]
assert s["notification-push"]["pull_policy"] == "never"
assert s["notification-push"]["environment"] == s["app"]["environment"]
assert s["notification-push"]["command"] == ["node", "scripts/notification-push.js"]
assert s["notification-push"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
assert not s["notification-push"].get("ports")

assert s["bike-week"]["image"] == s["migrate"]["image"]
assert s["bike-week"]["pull_policy"] == "never"
assert s["bike-week"]["environment"] == s["app"]["environment"]
assert s["bike-week"]["command"] == ["node", "scripts/bike-week.js"]
assert s["bike-week"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
assert not s["bike-week"].get("ports")
