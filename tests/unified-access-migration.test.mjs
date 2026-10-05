import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

void test('clean subscription migration removes only legacy access and preserves study, balances, catalogs and Superadmin', () => {
  const result = JSON.parse(
    execFileSync(
      'python',
      [
        '-c',
        `import sqlite3,json,pathlib
db=sqlite3.connect(':memory:')
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 if f.name.startswith('0035'): break
 db.executescript(f.read_text(encoding='utf-8'))
for uid,role in [('root','super_admin'),('member','student')]:
 profile=json.dumps(dict(uid=uid,email=uid+'@fixture.test',role=role,tier='full_quarterly'))
 db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)',(uid,uid+'@fixture.test','!','!',profile,None,'2026-01-01','2026-01-01'))
 db.execute('INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES(?,?,?,?,?)',('profiles',uid,uid,profile,'2026-01-01'))
db.execute("INSERT INTO subscriptions(user_id,status,method,paid,updated_at,plan) VALUES('member','active','manual',23000,'2026-01-01','full_quarterly')")
db.execute("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,source) VALUES('old-gift','member','full_monthly',1,'month','available','2026-01-01','admin')")
db.execute("INSERT INTO admin_plan_entitlements(id,user_id,plan,reason,granted_by,created_at) VALUES('old-grant','member','full_monthly','fixture','root','2026-01-01')")
study=json.dumps(dict(tests=[dict(id='study',questionIds=['q1'])],progress=dict(q1=dict(attempts=4))))
db.execute("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('state','member','member',?,'2026-01-01')",(study,))
db.execute("INSERT INTO app_states(user_id,payload,updated_at) VALUES('member',?,'2026-01-01')",(study,))
db.execute("INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,created_by,created_at) VALUES('credit-fixture','member',177,99,'historical_fixture','Synthetic credits','root','2026-01-01')")
db.execute("INSERT INTO test_registry(user_id,test_id,question_count,started_at) VALUES('member','study',1,'2026-01-01')")
preserved=['plan_prices','credit_transactions','contribution_accounts','test_registry','app_states']
before={t:db.execute('SELECT * FROM '+t).fetchall() for t in preserved}
db.commit()
db.executescript(pathlib.Path('drizzle/0035_unified_subscription_access.sql').read_text(encoding='utf-8'))
assert json.loads(db.execute("SELECT profile_json FROM profiles WHERE uid='member'").fetchone()[0])['tier']=='free'
assert json.loads(db.execute("SELECT profile_json FROM profiles WHERE uid='root'").fetchone()[0])['tier']=='full_quarterly'
assert db.execute("SELECT payload FROM records WHERE type='state' AND id='member'").fetchone()[0]==study
assert json.loads(db.execute("SELECT question_ids_json FROM test_registry WHERE user_id='member'").fetchone()[0])==['q1']
for t in preserved:
 after=db.execute('SELECT * FROM '+t).fetchall()
 if t=='test_registry': after=[r[:-2] for r in after]
 assert after==before[t],t
for t in ['subscriptions','reward_passes','admin_plan_entitlements','account_plan_overrides','subscription_events','account_access_revisions','access_grants','activation_codes']:
 assert db.execute('SELECT count(*) FROM '+t).fetchone()[0]==0,t
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps(dict(ok=True,preserved=preserved)))`,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(result.ok, true);
});
