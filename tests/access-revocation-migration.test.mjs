import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

void test('access revision migration preserves history and distinguishes legacy gifts before/after revocation', () => {
  const result = JSON.parse(execFileSync('python', ['-c', String.raw`
import sqlite3,pathlib,json,datetime
d=sqlite3.connect(':memory:');d.execute('PRAGMA foreign_keys=ON')
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 if f.name<'0034':d.executescript(f.read_text(encoding='utf-8'))
past='2026-01-01T00:00:00.000Z'; cutoff='2026-02-01T00:00:00.000Z'; after='2026-03-01T00:00:00.000Z'; future='2099-01-01T00:00:00.000Z'
for uid in ['current','expired','paid-after','paid-after-expired','normal']:
 p=dict(uid=uid,email=uid+'@test.invalid',tier='full_quarterly',displayName=uid)
 d.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)',(uid,p['email'],'!','!',json.dumps(p),None,past,past))
 if uid!='normal':d.execute('INSERT INTO account_plan_overrides VALUES(?,?,?,?,?,?)',(uid,'full_monthly' if uid.startswith('paid-after') else 'free',future if uid.startswith('paid-after') else (past if uid=='expired' else None),'reason','root',after if uid.startswith('paid-after') else cutoff))
 for suffix,status,activated in [('before','active',past),('after','active',after),('equal','active',cutoff),('unused','available',None)]:
  d.execute("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,duration_days,status,created_at,activated_at,expires_at,source,metadata) VALUES(?,?,'full_monthly',1,'month',9,?,?,?,?, 'admin',?)",(uid+'-'+suffix,uid,status,past,activated,future if activated else None,json.dumps(dict(reason='Keep',giftPopupSeenAt=past))))
 d.execute("INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,paid,updated_at,plan) VALUES(?,'active',?,?,'manual',23000,?,'full_quarterly')",(uid,past,future,after))
# Positive grant evidence must match the preserved current subscription.
d.execute("INSERT INTO subscription_events(id,user_id,email,name,action,original,discount,final,status,created_at,detail,plan,expires_at) VALUES('paid-event','current','test@example.test','Test','subscription_manually_activated',23000,0,23000,'success',?,'Preserve','full_quarterly',?)",(after,future))
payload=dict(id='revoke-old',entityId='paid-after',actorId='root',createdAt=cutoff,action='subscription_plan_overridden',detail=json.dumps(dict(next=dict(plan='free',expires_at=None))))
d.execute("INSERT INTO records(type,id,payload,updated_at)VALUES('auditLog','revoke-old',?,?)",(json.dumps(payload),cutoff))
# A later expired Free assignment supersedes an older permanent assignment.
for audit_id,at,end in [('superseded-free',past,None),('expired-free',cutoff,past)]:
 payload=dict(id=audit_id,entityId='paid-after-expired',actorId='root',createdAt=at,action='subscription_plan_overridden',detail=json.dumps(dict(next=dict(plan='free',expires_at=end))))
 d.execute("INSERT INTO records(type,id,payload,updated_at)VALUES('auditLog',?,?,?)",(audit_id,json.dumps(payload),at))
# Include an unrelated non-JSON audit detail; migration must tolerate it.
d.execute("INSERT INTO records(type,id,payload,updated_at)VALUES('auditLog','old-detail',?,?)",(json.dumps(dict(action='subscription_plan_overridden',detail='Legacy text')),past))
gift_fields='id,user_id,plan,duration,duration_unit,status,created_at,activated_at,expires_at,source,credit_transaction_id,metadata,duration_days'
before_gifts=d.execute('SELECT '+gift_fields+' FROM reward_passes ORDER BY id').fetchall()
before_paid=d.execute('SELECT user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan FROM subscriptions ORDER BY user_id').fetchall()
before_events=d.execute('SELECT * FROM subscription_events ORDER BY id').fetchall()
d.executescript(pathlib.Path('drizzle/0034_access_revocation_generations.sql').read_text(encoding='utf-8'))
assert d.execute('SELECT '+gift_fields+' FROM reward_passes ORDER BY id').fetchall()==before_gifts
assert d.execute('SELECT user_id,status,starts_at,expires_at,method,discount_code,paid,updated_at,plan FROM subscriptions ORDER BY user_id').fetchall()==before_paid
assert d.execute('SELECT * FROM subscription_events ORDER BY id').fetchall()==before_events
assert d.execute('SELECT user_id,generation FROM account_access_revisions ORDER BY user_id').fetchall()==[('current',1),('paid-after',1)]
for uid in ['current','paid-after']:
 for suffix in ['before','after','equal','unused']:
  generation=d.execute('SELECT access_generation FROM reward_passes WHERE id=?',(uid+'-'+suffix,)).fetchone()[0]
  assert generation==(1 if suffix=='after' else 0),(uid,suffix,generation)
assert d.execute("SELECT access_generation FROM subscriptions WHERE user_id='current'").fetchone()[0]==1
assert d.execute("SELECT access_generation FROM subscriptions WHERE user_id='paid-after'").fetchone()[0]==0
assert not d.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps(dict(ok=True,giftsPreserved=len(before_gifts),billingPreserved=len(before_paid),auditPreserved=True)))
`], { encoding: 'utf8' }));
  assert.deepEqual(result, { ok: true, giftsPreserved: 20, billingPreserved: 5, auditPreserved: true });
});
